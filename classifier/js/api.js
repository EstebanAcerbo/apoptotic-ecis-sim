/**
 * Simul_classifier — in-memory API layer
 *
 * Replaces all FastAPI fetch() calls with pure in-memory equivalents.
 * All simulation data lives in _simulations[] after initLibrary() is called.
 * The public surface is designed to be drop-in compatible with the v8 API
 * client so that downstream JS (classification.js, spectral.js, etc.) works
 * without modification.
 *
 * Public API:
 *   initLibrary(parsedSims)           — load parsed sim objects, return ParamsResponse shape
 *   apiFilterSimulations(overrides)   — return FilterResponse shape (no impedance)
 *   apiGetImpedanceBatch(ids)         — return Map<id, ImpedanceData-like object>
 *   apiGetFilterCount(overrides)      — return { count }
 *   apiClassify(expSpectrum, options) — client-side classification (full implementation)
 *   apiFitGK(req)                     — not available standalone; returns error
 *   apiFitCPE(req)                    — not available standalone; returns error
 *   resultItemToSim(item)             — convert classify result to v7-compat sim object
 *   impedanceDataToSim(imp, meta)     — convert impedance data + metadata to v7-compat sim
 *
 * serverLibrary mirrors the v8 api.js shape so that dataLoading.js and
 * classification.js can read serverLibrary.connected, serverLibrary.params,
 * serverLibrary.filters, etc. without changes.
 */

// ---------------------------------------------------------------------------
// Internal simulation store
// ---------------------------------------------------------------------------

/** @type {Array} All simulation objects loaded via initLibrary() */
let _simulations = [];

// ---------------------------------------------------------------------------
// Server library state — mirrors v8 api.js shape for downstream compatibility
// ---------------------------------------------------------------------------

let serverLibrary = {
    connected:        false,
    params:           null,      // ParamsResponse — set once by initLibrary()
    electrode_profiles: [],
    counts_per_shape:   {},

    // Active filter selections — updated by UI controls
    filters: {
        types:            new Set(),
        acpe:             new Set(),
        ncpe:             new Set(),
        de_um:            new Set(),
        electrode_shapes: new Set(),
        ac:               new Set(),
        alpha:            new Set(),
        rb:               new Set(),
        cm:               new Set(),
        cell_shapes:      new Set(),
        hw_ratios:        new Set(),
        steps: {
            wh:  new Set(),
            ran: new Set(),
            fus: new Set(),
            cov: new Set(),
            inf: new Set(),
            rup: new Set(),
        },
    },

    // Impedance cache — keyed by sim_id (all data already in _simulations,
    // but this map is used by apiGetImpedanceBatch for O(1) lookup)
    impedanceCache: new Map(),
};


// ---------------------------------------------------------------------------
// initLibrary — populate _simulations from parsed file objects
// ---------------------------------------------------------------------------

/**
 * Initialise the in-memory library from an array of parsed simulation objects.
 * Each object must have the shape produced by parseFilename() + parseFileContent():
 *   { type, ac, alpha, rb, cm, step, per, n, iter, rConstr,
 *     frequency[], impedance[{real,imag}], headerData{...} }
 *
 * Returns a ParamsResponse-compatible object (same shape as GET /api/params).
 */
function initLibrary(parsedSims) {
    _simulations = parsedSims;

    // Build unique value sets
    const types       = new Set();
    const ac          = new Set();
    const alpha       = new Set();
    const rb          = new Set();
    const cm          = new Set();
    const cell_shapes = new Set();
    const hw_ratios   = new Set();
    const acpe        = new Set();
    const ncpe        = new Set();
    const de_um       = new Set();
    const stepsWh     = new Set();
    const stepsRan    = new Set();
    const stepsFus    = new Set();

    for (const sim of parsedSims) {
        if (sim.type)  types.add(sim.type);
        if (sim.ac   != null) ac.add(round3(sim.ac));
        if (sim.alpha != null) alpha.add(round3(sim.alpha));
        if (sim.rb   != null) rb.add(round3(sim.rb));
        if (sim.cm   != null) cm.add(sim.cm);
        if (sim.cell_shape) cell_shapes.add(sim.cell_shape);
        if (sim.hw_ratio != null) hw_ratios.add(sim.hw_ratio);
        if (sim.headerData?.ACPE != null) acpe.add(sim.headerData.ACPE);
        if (sim.headerData?.nCPE != null) ncpe.add(sim.headerData.nCPE);
        if (sim.headerData?.de   != null) de_um.add(sim.headerData.de);

        const t = sim.type;
        if (t === 'wh') {
            if (sim.step != null) stepsWh.add(sim.step);
        } else if (t === 'ran') {
            if (sim.per  != null) stepsRan.add(sim.per);
        } else if (t === 'fus' || t === 'inf' || t === 'rup') {
            if (sim.step != null) stepsFus.add(sim.step);
        }
    }

    const sortNum = s => [...s].sort((a, b) => a - b);
    const sortStr = s => [...s].sort();

    // Build counts_per_type
    const counts_per_type = {};
    for (const t of types) {
        counts_per_type[t] = parsedSims.filter(s => s.type === t).length;
    }

    // Build counts_per_shape
    const counts_per_shape = {};
    for (const sh of cell_shapes) {
        counts_per_shape[sh] = parsedSims.filter(s => s.cell_shape === sh).length;
    }

    // Build electrode profiles from unique (de, acpe, ncpe) combos
    const profileMap = new Map();
    for (const sim of parsedSims) {
        const d  = sim.headerData?.de;
        const a  = sim.headerData?.ACPE;
        const n  = sim.headerData?.nCPE;
        if (d == null || a == null || n == null) continue;
        const key = `${d}|${a}|${n}`;
        if (!profileMap.has(key)) profileMap.set(key, { de_um: d, acpe: a, ncpe: n, count: 0 });
        profileMap.get(key).count++;
    }
    const electrode_profiles = [...profileMap.values()];

    // Build params_per_type
    const params_per_type = {};
    for (const t of types) {
        const tSims = parsedSims.filter(s => s.type === t);
        params_per_type[t] = {
            ac:    sortNum(new Set(tSims.map(s => round3(s.ac)))),
            alpha: sortNum(new Set(tSims.map(s => round3(s.alpha)))),
            rb:    sortNum(new Set(tSims.map(s => round3(s.rb)))),
            cm:    sortNum(new Set(tSims.map(s => s.cm))),
        };
    }

    const params = {
        types:             sortStr(types),
        ac:                sortNum(ac),
        alpha:             sortNum(alpha),
        rb:                sortNum(rb),
        cm:                sortNum(cm),
        cell_shapes:       sortStr(cell_shapes),
        hw_ratios:         sortNum(hw_ratios),
        acpe:              sortNum(acpe),
        ncpe:              sortNum(ncpe),
        de_um:             sortNum(de_um),
        electrode_shapes:  [],
        electrode_profiles,
        steps: {
            wh:  sortNum(stepsWh),
            ran: sortNum(stepsRan),
            fus: sortNum(stepsFus),
            inf: [],
            rup: [],
        },
        total_simulations: parsedSims.length,
        params_per_type,
        counts_per_type,
        counts_per_shape,
    };

    // Populate serverLibrary state so downstream code reads it correctly
    serverLibrary.params             = params;
    serverLibrary.electrode_profiles = electrode_profiles;
    serverLibrary.counts_per_shape   = counts_per_shape;
    serverLibrary.connected          = true;

    // Initialise filters: select everything by default
    serverLibrary.filters.types            = new Set(params.types);
    serverLibrary.filters.acpe             = new Set(params.acpe);
    serverLibrary.filters.ncpe             = new Set(params.ncpe);
    serverLibrary.filters.de_um            = new Set(params.de_um);
    serverLibrary.filters.electrode_shapes = new Set(params.electrode_shapes);
    serverLibrary.filters.ac               = new Set(params.ac);
    serverLibrary.filters.alpha            = new Set(params.alpha);
    serverLibrary.filters.rb               = new Set(params.rb);
    serverLibrary.filters.cm               = new Set(params.cm);
    serverLibrary.filters.cell_shapes      = new Set(params.cell_shapes);
    serverLibrary.filters.hw_ratios        = new Set(params.hw_ratios);

    serverLibrary.filters.steps.wh  = new Set(params.steps.wh);
    serverLibrary.filters.steps.ran = new Set(params.steps.ran);
    serverLibrary.filters.steps.fus = new Set(params.steps.fus);
    serverLibrary.filters.steps.cov = new Set();
    serverLibrary.filters.steps.inf = new Set();
    serverLibrary.filters.steps.rup = new Set();

    // Populate impedance cache keyed by sim_id (= array index, assigned during file parse)
    serverLibrary.impedanceCache.clear();
    for (const sim of parsedSims) {
        if (sim.id != null) {
            serverLibrary.impedanceCache.set(sim.id, {
                id:             sim.id,
                r_constr:       sim.rConstr ?? sim.headerData?.rConstr ?? 0,
                header_json:    JSON.stringify(sim.headerData ?? {}),
                frequencies:    sim.frequency,
                impedance_real: sim.impedance.map(z => z.real),
                impedance_imag: sim.impedance.map(z => z.imag),
            });
        }
    }

    return params;
}


// ---------------------------------------------------------------------------
// Internal filter helper
// ---------------------------------------------------------------------------

/**
 * Filter _simulations in-memory according to an overrides object.
 * Accepts the same parameter fields as v8 apiFilterSimulations():
 *   types, acpe, ncpe, de_um, electrode_shapes, ac, alpha, rb, cm,
 *   cell_shapes, hw_ratios, steps, limit, offset
 *
 * All numeric comparisons use a small tolerance (1e-9) to handle
 * floating-point rounding between filename parsing and filter chips.
 */
function _filterSims(overrides = {}) {
    const f = serverLibrary.filters;
    const toArr = v => (v instanceof Set ? [...v] : (Array.isArray(v) ? v : []));
    const numClose = (a, b) => Math.abs(a - b) < 1e-9;

    const types       = overrides.types       != null ? toArr(overrides.types)       : toArr(f.types);
    const acArr       = overrides.ac          != null ? toArr(overrides.ac)           : toArr(f.ac);
    const alphaArr    = overrides.alpha       != null ? toArr(overrides.alpha)        : toArr(f.alpha);
    const rbArr       = overrides.rb          != null ? toArr(overrides.rb)           : toArr(f.rb);
    const cmArr       = overrides.cm          != null ? toArr(overrides.cm)           : toArr(f.cm);
    const cellShapes  = overrides.cell_shapes != null ? toArr(overrides.cell_shapes)  : toArr(f.cell_shapes);
    const hwRatios    = overrides.hw_ratios   != null ? toArr(overrides.hw_ratios)    : toArr(f.hw_ratios);
    const stepsFlat   = overrides.steps       != null ? toArr(overrides.steps)        : null; // flat override

    const limit  = overrides.limit  != null ? overrides.limit  : 100000;
    const offset = overrides.offset != null ? overrides.offset : 0;

    let results = _simulations;

    // Type filter
    if (types.length > 0) {
        const typeSet = new Set(types);
        results = results.filter(s => typeSet.has(s.type));
    }

    // GK param filters (numeric tolerance)
    if (acArr.length    > 0) results = results.filter(s => acArr.some(v    => numClose(round3(s.ac),    round3(v))));
    if (alphaArr.length > 0) results = results.filter(s => alphaArr.some(v => numClose(round3(s.alpha), round3(v))));
    if (rbArr.length    > 0) results = results.filter(s => rbArr.some(v    => numClose(round3(s.rb),    round3(v))));
    if (cmArr.length    > 0) results = results.filter(s => cmArr.some(v    => numClose(s.cm, v)));

    // Cell geometry filters
    if (cellShapes.length > 0) {
        const csSet = new Set(cellShapes);
        results = results.filter(s => !s.cell_shape || csSet.has(s.cell_shape));
    }
    if (hwRatios.length > 0) {
        results = results.filter(s => s.hw_ratio == null || hwRatios.some(v => numClose(s.hw_ratio, v)));
    }

    // Step filter (flat)
    if (stepsFlat && stepsFlat.length > 0) {
        results = results.filter(s => {
            const simStep = s.type === 'ran' ? s.per : s.step;
            return stepsFlat.some(v => numClose(simStep, v));
        });
    }

    // Pagination
    return results.slice(offset, offset + limit);
}


// ---------------------------------------------------------------------------
// apiFilterSimulations — returns FilterResponse shape
// ---------------------------------------------------------------------------

async function apiFilterSimulations(overrides = {}) {
    const filtered = _filterSims(overrides);

    const simulations = filtered.map(s => ({
        id:          s.id,
        type:        s.type,
        ac:          s.ac,
        alpha:       s.alpha,
        rb:          s.rb,
        cm:          s.cm,
        step:        s.step,
        per:         s.per  ?? s.step ?? 0,
        n:           s.n    ?? 0,
        iter:        s.iter ?? 1,
        r_constr:    s.rConstr ?? s.headerData?.rConstr ?? 0,
        cell_shape:  s.cell_shape  ?? '',
        hw_ratio:    s.hw_ratio    ?? 0,
        acpe:        s.headerData?.ACPE ?? null,
        ncpe:        s.headerData?.nCPE ?? null,
        is_averaged: s.is_averaged ?? (s.iter > 1),
        num_freq_points: s.frequency?.length ?? 0,
    }));

    return { count: simulations.length, simulations };
}


// ---------------------------------------------------------------------------
// apiGetFilterCount — returns { count }
// ---------------------------------------------------------------------------

async function apiGetFilterCount(overrides = {}) {
    const filtered = _filterSims(overrides);
    return { count: filtered.length };
}


// ---------------------------------------------------------------------------
// apiGetImpedanceBatch — returns Map<id, ImpedanceData-like>
// ---------------------------------------------------------------------------

async function apiGetImpedanceBatch(ids) {
    const result = new Map();
    for (const id of ids) {
        let entry = serverLibrary.impedanceCache.get(id);
        if (!entry) {
            // Fallback: find by id in _simulations
            const sim = _simulations.find(s => s.id === id);
            if (sim) {
                entry = {
                    id:             sim.id,
                    r_constr:       sim.rConstr ?? sim.headerData?.rConstr ?? 0,
                    header_json:    JSON.stringify(sim.headerData ?? {}),
                    frequencies:    sim.frequency,
                    impedance_real: sim.impedance.map(z => z.real),
                    impedance_imag: sim.impedance.map(z => z.imag),
                };
                serverLibrary.impedanceCache.set(id, entry);
            }
        }
        if (entry) result.set(id, entry);
    }
    return result;
}


// ---------------------------------------------------------------------------
// apiClassify — client-side classification against in-memory library
// ---------------------------------------------------------------------------

async function apiClassify(expSpectrum, options = {}) {
    const f = serverLibrary.filters;

    // Sanitize spectrum
    const rawFreqs  = expSpectrum.frequency  || [];
    const rawMags   = expSpectrum.magnitude  || [];
    const rawPhases = expSpectrum.phase      || [];
    const validIdx  = rawFreqs.map((_, i) =>
        isFinite(rawMags[i]) && rawMags[i] != null && rawMags[i] > 0 &&
        isFinite(rawPhases[i]) && rawPhases[i] != null
    );
    const cleanFreqs  = rawFreqs.filter((_,i)  => validIdx[i]);
    const cleanMags   = rawMags.filter((_,i)   => validIdx[i]);
    const cleanPhases = rawPhases.filter((_,i) => validIdx[i]);

    if (cleanFreqs.length === 0) {
        throw new Error('No valid frequency points in spectrum (all NaN/null after conversion)');
    }

    // Build candidate set from in-memory store using current filter state
    const toArr = v => (v instanceof Set ? [...v] : (Array.isArray(v) ? v : []));

    const candidateTypes  = options.types       ?? toArr(f.types);
    const candidateAc     = options.ac          ?? toArr(f.ac);
    const candidateAlpha  = options.alpha       ?? toArr(f.alpha);
    const candidateRb     = options.rb          ?? toArr(f.rb);
    const candidateCm     = options.cm          ?? toArr(f.cm);
    const candidateShapes = options.cell_shapes ?? toArr(f.cell_shapes);
    const candidateHw     = options.hw_ratios   ?? toArr(f.hw_ratios);

    const allSteps = options.steps ?? Object.values(f.steps).flatMap(s => [...s]);
    const uniqueSteps = [...new Set(allSteps.map(Number))];

    const overrideRConstr = options.r_constr_override ?? null;
    const metric          = options.metric  ?? 'log_rmse';
    const freqMin         = options.freq_min ?? 100;
    const freqMax         = options.freq_max ?? 1_000_000;
    const topN            = options.top_n ?? 100;
    const enableGrouping  = options.enable_grouping ?? true;
    const groupBy         = options.group_by ?? ['ac', 'alpha', 'rb', 'cm'];

    const candidates = _filterSims({
        types:       candidateTypes.length     ? candidateTypes     : undefined,
        ac:          candidateAc.length        ? candidateAc        : undefined,
        alpha:       candidateAlpha.length     ? candidateAlpha     : undefined,
        rb:          candidateRb.length        ? candidateRb        : undefined,
        cm:          candidateCm.length        ? candidateCm        : undefined,
        cell_shapes: candidateShapes.length    ? candidateShapes    : undefined,
        hw_ratios:   candidateHw.length        ? candidateHw        : undefined,
        steps:       uniqueSteps.length        ? uniqueSteps        : undefined,
        limit: 200000,
    });

    if (candidates.length === 0) {
        throw new Error('No simulations match the current filters — try broadening your parameter selection');
    }

    // Build experimental interpolated arrays over the frequency window
    const expPairs = cleanFreqs.map((f, i) => ({ f, mag: cleanMags[i], ph: cleanPhases[i] }))
        .filter(p => p.f >= freqMin && p.f <= freqMax);
    if (expPairs.length === 0) {
        throw new Error('No experimental frequency points in the selected frequency window');
    }
    const expF   = expPairs.map(p => p.f);
    const expMag = expPairs.map(p => p.mag);
    const expPh  = expPairs.map(p => p.ph);

    // Distance function
    function computeDistance(simFreqs, simReal, simImag, rConstr) {
        // Interpolate simulation to experimental frequencies
        const simMags  = [];
        const simPhases = [];

        for (let i = 0; i < expF.length; i++) {
            const ef = expF[i];
            // Find bracketing points in simFreqs (sorted ascending or descending)
            let lo = -1, hi = -1;
            for (let j = 0; j < simFreqs.length - 1; j++) {
                const f0 = simFreqs[j], f1 = simFreqs[j + 1];
                if ((f0 <= ef && ef <= f1) || (f1 <= ef && ef <= f0)) {
                    lo = j; hi = j + 1;
                    break;
                }
            }
            let zr, zi;
            if (lo < 0) {
                // Out of range — skip this point
                simMags.push(null);
                simPhases.push(null);
                continue;
            }
            const f0 = simFreqs[lo], f1 = simFreqs[hi];
            const t  = f0 === f1 ? 0 : (ef - f0) / (f1 - f0);
            zr = simReal[lo]  + t * (simReal[hi]  - simReal[lo]);
            zi = simImag[lo]  + t * (simImag[hi]  - simImag[lo]);

            // Apply R_constr offset: sim stores Z_electrode only; add R_constr to Re(Z)
            zr += rConstr;

            simMags.push(Math.sqrt(zr * zr + zi * zi));
            simPhases.push(Math.atan2(zi, zr) * 180 / Math.PI);
        }

        // Compute distance over valid points
        let sum = 0, count = 0;
        for (let i = 0; i < expF.length; i++) {
            if (simMags[i] == null) continue;
            const em = expMag[i], sm = simMags[i];
            if (!isFinite(em) || !isFinite(sm) || em <= 0 || sm <= 0) continue;
            if (metric === 'log_rmse') {
                const d = Math.log10(em) - Math.log10(sm);
                sum += d * d;
            } else if (metric === 'log_mae') {
                sum += Math.abs(Math.log10(em) - Math.log10(sm));
            } else if (metric === 'rmse') {
                const d = em - sm;
                sum += d * d;
            } else if (metric === 'mae') {
                sum += Math.abs(em - sm);
            } else if (metric === 'relerr') {
                sum += Math.abs(em - sm) / em;
            } else {
                const d = Math.log10(em) - Math.log10(sm);
                sum += d * d;
            }
            count++;
        }
        if (count === 0) return Infinity;
        return metric === 'log_rmse' || metric === 'rmse'
            ? Math.sqrt(sum / count)
            : sum / count;
    }

    // Score all candidates
    const scored = [];
    for (const sim of candidates) {
        const rConstr = overrideRConstr != null
            ? overrideRConstr
            : (sim.rConstr ?? sim.headerData?.rConstr ?? 0);

        const simReal = sim.impedance.map(z => z.real);
        const simImag = sim.impedance.map(z => z.imag);

        const dist = computeDistance(sim.frequency, simReal, simImag, rConstr);
        if (isFinite(dist)) {
            scored.push({ sim, dist, rConstr });
        }
    }

    scored.sort((a, b) => a.dist - b.dist);

    // Optional grouping: keep best per group
    let ranked;
    if (enableGrouping && scored.length > 0) {
        const seen   = new Map();
        const output = [];
        for (const entry of scored) {
            const s = entry.sim;
            const key = groupBy.map(k => s[k] ?? '').join('|');
            if (!seen.has(key)) {
                seen.set(key, true);
                output.push(entry);
            }
        }
        ranked = output;
    } else {
        ranked = scored;
    }

    const top = ranked.slice(0, topN);

    // Build ClassifyResponse-compatible output
    const results = top.map((entry, idx) => {
        const s = entry.sim;
        return {
            rank:     idx + 1,
            sim_id:   s.id,
            distance: entry.dist,
            type:      s.type,
            ac:        s.ac,
            alpha:     s.alpha,
            rb:        s.rb,
            cm:        s.cm,
            step:      s.step,
            per:       s.per ?? s.step ?? 0,
            n:         s.n   ?? 0,
            r_constr:  entry.rConstr,
            cell_shape: s.cell_shape  ?? '',
            hw_ratio:   s.hw_ratio    ?? 0,
            is_averaged: s.is_averaged ?? (s.iter > 1),
            header_json: JSON.stringify(s.headerData ?? {}),
            frequencies:    s.frequency,
            impedance_real: s.impedance.map(z => z.real + entry.rConstr),
            impedance_imag: s.impedance.map(z => z.imag),
        };
    });

    // Cache result impedances for spectral overlay without re-fetch
    for (const r of results) {
        serverLibrary.impedanceCache.set(r.sim_id, {
            id:             r.sim_id,
            r_constr:       r.r_constr,
            header_json:    r.header_json,
            frequencies:    r.frequencies,
            impedance_real: r.impedance_real,
            impedance_imag: r.impedance_imag,
        });
    }

    return {
        results,
        total_compared:  candidates.length,
        metric,
        enable_grouping: enableGrouping,
    };
}


// ---------------------------------------------------------------------------
// apiFitGK / apiFitCPE — not available without Python backend
// ---------------------------------------------------------------------------

async function apiFitGK(req) {
    throw new Error('GK analytical fitting requires the Python backend and is not available in standalone file mode.');
}

async function apiFitCPE(req) {
    throw new Error('CPE analytical fitting requires the Python backend and is not available in standalone file mode.');
}


// ---------------------------------------------------------------------------
// Compatibility stubs — used by v8 code paths that call these directly
// ---------------------------------------------------------------------------

async function apiHealthCheck() {
    return { status: 'ok', mode: 'file-based' };
}

async function apiInitLibrary() {
    // In file-based mode, initLibrary() is called with parsed sims, not via API.
    // This stub exists so code that calls apiInitLibrary() doesn't throw.
    if (serverLibrary.params) return serverLibrary.params;
    throw new Error('Library not initialised — load simulation files first');
}


// ---------------------------------------------------------------------------
// Adapter helpers — convert in-memory sim objects to v7-compatible shapes
// (identical logic to v8 api.js so downstream code works unchanged)
// ---------------------------------------------------------------------------

function resultItemToSim(item) {
    const header = (() => {
        try { return JSON.parse(item.header_json); } catch (_) { return {}; }
    })();

    const impedance = item.frequencies.map((_, i) => ({
        real: item.impedance_real[i],
        imag: item.impedance_imag[i],
    }));

    return {
        type:      item.type,
        ac:        item.ac,
        alpha:     item.alpha,
        rb:        item.rb,
        cm:        item.cm,
        step:      item.step,
        per:       item.per,
        n:         item.n,
        iter:      item.is_averaged ? item.n : 1,
        rConstr:   item.r_constr,

        frequency:  item.frequencies,
        impedance:  impedance,

        headerData: {
            rConstr:          item.r_constr,
            totalCells:       header.totalCells       ?? 729,
            aliveCells:       header.aliveCells       ?? 0,
            deadCells:        header.deadCells        ?? 0,
            fusedCells:       header.fusedCells       ?? 0,
            initialInfection: header.initialInfection ?? 0,
            electrodeCells:   header.electrodeCells   ?? 0,
            coverage:         header.coverage         ?? 0,
            cellsOnElectrode: header.cellsOnElectrode ?? 0,
            simType:          item.type,
            whStage:          header.whStage          ?? 0,
            h:                header.h                ?? null,
            apoStages:        header.apoStages        ?? [],
            apoTotal:         header.apoTotal         ?? 0,
        },

        sim_id:      item.sim_id,
        cell_shape:  item.cell_shape,
        hw_ratio:    item.hw_ratio,
        is_averaged: item.is_averaged,
        _apiRank:    item.rank,
        _apiDist:    item.distance,
    };
}

function impedanceDataToSim(impedanceData, metadata) {
    const impedance = impedanceData.frequencies.map((_, i) => ({
        real: impedanceData.impedance_real[i],
        imag: impedanceData.impedance_imag[i],
    }));

    const rConstr = impedanceData.r_constr ?? 0;

    let h = {};
    if (impedanceData.header_json) {
        try { h = JSON.parse(impedanceData.header_json); } catch (_) {}
    }

    return {
        ...metadata,
        rConstr,
        frequency:  impedanceData.frequencies,
        impedance:  impedance,
        headerData: {
            rConstr,
            totalCells:       h.totalCells       ?? 729,
            aliveCells:       h.aliveCells       ?? 0,
            deadCells:        h.deadCells        ?? 0,
            fusedCells:       h.fusedCells       ?? 0,
            initialInfection: h.initialInfection ?? 0,
            electrodeCells:   h.electrodeCells   ?? 0,
            cellsOnElectrode: h.cellsOnElectrode ?? 0,
            coverage:         h.coverage         ?? 0,
            simType:          h.simType          ?? metadata?.type ?? '',
            whStage:          h.whStage          ?? 0,
            h:                h.h                ?? null,
            ...(metadata?.headerData ?? {}),
        },
    };
}
