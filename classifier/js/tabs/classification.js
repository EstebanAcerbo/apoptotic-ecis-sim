// ============================================================
// ECIS CLASSIFIER - CLASSIFICATION MODULE
// ============================================================
// Core classification algorithm that matches experimental spectra
// to simulation library using distance metrics.
//
// Supports:
// - Single-phase and multi-phase classification
// - Groupby optimization (find best parameter group for all spectra)
// - Multiple error metrics (RMSE, MAE, log variants, relative error)
// - Combined electrode simulations
//
// Key functions:
// - runClassification(): Main entry point
// - performClassification(): Core algorithm
// - calculateDistance(): Compute error between spectrum and simulation
// - updateResultsPlots(): Generate result visualizations
// - exportResults(): Export to CSV/TSV
// ============================================================

function runClassification() {
    if (experimentalData.processed.length === 0) {
        showStatus('Load experimental data first', 'error');
        return;
    }
    if (!serverLibrary.connected) {
        showStatus('Connect to simulation library first', 'error');
        return;
    }
    if (selectedChannels.fitting.size === 0) {
        showStatus('Select at least one channel for fitting', 'error');
        return;
    }

    document.getElementById('loadingFitting').classList.add('active');
    document.getElementById('runFitBtn').disabled = true;

    // async wrapper — classification now calls the API
    performClassificationAsync().finally(() => {
        document.getElementById('loadingFitting').classList.remove('active');
        document.getElementById('runFitBtn').disabled = false;
    });
}

async function performClassificationAsync() {
    const filters        = getSelectedFilters();
    const freq_min       = parseFloat(document.getElementById('freq_min').value) || 100;
    const freq_max       = parseFloat(document.getElementById('freq_max').value) || 1_000_000;
    const selectedMetric = document.querySelector('input[name="errorMetric"]:checked').value;
    const enableGrouping = document.getElementById('enableGrouping').checked;
    const phaseDefinitions = getPhaseDefinitions();

    // Build groupBy list from checkboxes (same as v7 getGroupKey)
    const group_by = [];
    if (document.getElementById('groupBy_type')?.checked)  group_by.push('type');
    if (document.getElementById('groupBy_ac')?.checked)    group_by.push('ac');
    if (document.getElementById('groupBy_alpha')?.checked) group_by.push('alpha');
    if (document.getElementById('groupBy_rb')?.checked)    group_by.push('rb');
    if (document.getElementById('groupBy_cm')?.checked)    group_by.push('cm');

    // R_constr override
    const rConstrOverride = document.getElementById('overwriteRConstr')?.checked
        ? (parseFloat(document.getElementById('overwriteRConstrValue')?.value) || null)
        : null;

    const channels = [...selectedChannels.fitting];
    classificationResults = [];
    let totalCompared = 0;

    const allSpectra = experimentalData.processed;

    // Detect whether sims are loaded in memory (either via loadSimsForClassification
    // or via combination). If so, use client-side classification.
    const localSimsInMemory = _hasLocalSimsLoaded();
    const combinedInMemory  = _hasCombinedSimsLoaded();

    // Progress display
    const progressEl = document.getElementById('fittingProgress');

    // ── Collect ALL candidate sims once (client-side path) ──────────────────
    // Use a Set to avoid duplicates efficiently (avoids O(N²) includes() calls).
    let candidateSims = [];
    if (localSimsInMemory) {
        const seen = new Set();
        ['wh', 'ran', 'inf', 'rup', 'apo'].forEach(slot => {
            (simulationData[slot] || []).forEach(s => {
                if (!seen.has(s)) { seen.add(s); candidateSims.push(s); }
            });
        });
        totalCompared = candidateSims.length;
        debugLog(`Client-side: ${candidateSims.length} candidate sims (${combinedInMemory ? 'combined' : 'no combined'})`);
    }
    // ────────────────────────────────────────────────────────────────────────

    for (const chName of channels) {
        const chSpectra = allSpectra
            .filter(d => d.channelName === chName)
            .sort((a, b) => a.time - b.time);
        if (chSpectra.length === 0) continue;

        debugLog(`=== Channel ${chName}: ${chSpectra.length} spectra ===`);

        // Yield to the browser so the loading overlay can paint before heavy work
        await new Promise(r => setTimeout(r, 0));
        if (progressEl) progressEl.textContent = `${chName}: 0 / ${chSpectra.length}…`;

        // Split spectra into stage groups.
        // Each stage runs its own independent groupby classification so the optimal
        // parameter group can differ between stages.
        // If no stages are defined, one group covering all spectra is used.
        // Stages can be defined by spectrum index (default) or by time [h] (byTime flag).
        const stageGroups = phaseDefinitions
            ? phaseDefinitions.map(ph => {
                if (ph.byTime) {
                    // Convert time boundaries [h] → spectrum indices for this channel
                    const startIdx = chSpectra.findIndex(s => s.timeHours >= ph.startTimeH);
                    const safeStart = startIdx >= 0 ? startIdx : 0;
                    let endIdx = chSpectra.length - 1;
                    for (let i = chSpectra.length - 1; i >= 0; i--) {
                        if (chSpectra[i].timeHours <= ph.endTimeH) { endIdx = i; break; }
                    }
                    return {
                        phaseName: ph.phaseName,
                        spectra:   chSpectra.slice(safeStart, endIdx + 1),
                        offset:    safeStart,
                    };
                }
                return {
                    phaseName: ph.phaseName,
                    spectra:   chSpectra.slice(ph.startIndex, ph.endIndex + 1),
                    offset:    ph.startIndex,
                };
            })
            : [{ phaseName: null, spectra: chSpectra, offset: 0 }];

        if (localSimsInMemory) {
            // ── Client-side path ────────────────────────────────────────────
            if (candidateSims.length === 0) continue;

            for (const { phaseName, spectra, offset } of stageGroups) {
                if (spectra.length === 0) continue;
                const stageLabel = phaseName ? ` [${phaseName}]` : '';

                if (enableGrouping && group_by.length > 0) {
                    // ── Two-pass cross-time groupby for this stage ───────────
                    // Find ONE parameter group whose cumulative distance across
                    // ALL spectra in this stage is minimum (temporal consistency).
                    //
                    // Pass 1: score all sims for every spectrum; accumulate per-group
                    //         sum of (best-in-group distance per spectrum).
                    // Pass 2: pick the group with min cumulative sum; assign each
                    //         spectrum to the best sim within that winning group.

                    const groupTotalDist   = {};  // groupKey → Σ(best dist per spectrum)
                    const groupBestPerSpec = {};  // groupKey → array[si] of {sim, distance}

                    for (let si = 0; si < spectra.length; si++) {
                        // Yield every 5 spectra so the browser can repaint
                        if (si % 5 === 0) await new Promise(r => setTimeout(r, 0));
                        if (progressEl) progressEl.textContent =
                            `${chName}${stageLabel}: scoring ${si + 1} / ${spectra.length}…`;

                        const spectrum   = spectra[si];
                        const groupsBest = {}; // groupKey → best {sim, distance} for this spectrum

                        candidateSims.forEach(sim => {
                            const dist = calculateDistance(sim, spectrum, freq_min, freq_max, selectedMetric);
                            if (!isFinite(dist)) return;
                            const key = getGroupKey(sim);
                            if (!groupsBest[key] || dist < groupsBest[key].distance) {
                                groupsBest[key] = { sim, distance: dist };
                            }
                        });

                        for (const [key, best] of Object.entries(groupsBest)) {
                            groupTotalDist[key] = (groupTotalDist[key] || 0) + best.distance;
                            if (!groupBestPerSpec[key]) groupBestPerSpec[key] = [];
                            groupBestPerSpec[key][si] = best;
                        }
                    }

                    // Find the group with minimum cumulative distance across this stage
                    let bestKey = null, bestTotal = Infinity;
                    for (const [key, total] of Object.entries(groupTotalDist)) {
                        if (total < bestTotal) { bestTotal = total; bestKey = key; }
                    }

                    if (progressEl) progressEl.textContent = `${chName}${stageLabel}: groupby done — ${bestKey}`;
                    debugLog(`Groupby best for ${chName}${stageLabel}: ${bestKey} (Σdist=${bestTotal.toFixed(4)})`);

                    // Pass 2: build results from best group, tagging phaseName
                    for (let si = 0; si < spectra.length; si++) {
                        const spectrum = spectra[si];
                        const best = groupBestPerSpec[bestKey]?.[si];
                        if (!best) continue;
                        classificationResults.push({
                            channel:       chName,
                            spectrumIndex: offset + si,
                            time:          spectrum.time,
                            timeHours:     spectrum.timeHours,
                            spectrum,
                            bestSim:       best.sim,
                            distance:      best.distance,
                            groupKey:      bestKey,
                            phaseName,
                            _allResults:   [],
                        });
                    }

                } else {
                    // ── No groupby: per-spectrum minimum distance ────────────
                    for (let si = 0; si < spectra.length; si++) {
                        if (si % 5 === 0) await new Promise(r => setTimeout(r, 0));
                        if (progressEl) progressEl.textContent =
                            `${chName}${stageLabel}: spectrum ${si + 1} / ${spectra.length}…`;

                        const spectrum = spectra[si];
                        const scored = candidateSims
                            .map(sim => ({
                                sim,
                                distance: calculateDistance(sim, spectrum, freq_min, freq_max, selectedMetric),
                            }))
                            .filter(s => isFinite(s.distance));
                        if (scored.length === 0) continue;

                        scored.sort((a, b) => a.distance - b.distance);
                        const top = scored.slice(0, 100);

                        classificationResults.push({
                            channel:       chName,
                            spectrumIndex: offset + si,
                            time:          spectrum.time,
                            timeHours:     spectrum.timeHours,
                            spectrum,
                            bestSim:       top[0].sim,
                            distance:      top[0].distance,
                            groupKey:      `${top[0].sim.type}_ac${top[0].sim.ac}_alpha${top[0].sim.alpha}_rb${top[0].sim.rb}_cm${top[0].sim.cm.toExponential(2)}`,
                            phaseName,
                            _allResults:   top.map((s, i) => ({ rank: i + 1, sim: s.sim, distance: s.distance })),
                        });
                    }
                }
            }
            // ────────────────────────────────────────────────────────────────

        } else {
            // ── Server-side path (normal API classification) ─────────────────
            for (const { phaseName, spectra, offset } of stageGroups) {
                if (spectra.length === 0) continue;
                for (let specIdx = 0; specIdx < spectra.length; specIdx++) {
                    const spectrum = spectra[specIdx];
                    if (progressEl) progressEl.textContent =
                        `${chName}: spectrum ${offset + specIdx + 1} / ${chSpectra.length}…`;

                    let response;
                    try {
                        response = await apiClassify(spectrum, {
                            freq_min, freq_max,
                            metric:            selectedMetric,
                            r_constr_override: rConstrOverride,
                            enable_grouping:   enableGrouping,
                            group_by,
                            top_n: 100,
                            ...filters,
                        });
                    } catch (err) {
                        showStatus(`Classification error: ${err.message}`, 'error');
                        return;
                    }

                    if (specIdx === 0 && offset === 0) totalCompared = response.total_compared;

                    const bestResult = response.results[0];
                    if (!bestResult) continue;

                    const bestSim = resultItemToSim(bestResult);
                    classificationResults.push({
                        channel:       chName,
                        spectrumIndex: offset + specIdx,
                        time:          spectrum.time,
                        timeHours:     spectrum.timeHours,
                        spectrum,
                        bestSim,
                        distance:      bestResult.distance,
                        groupKey:      `${bestSim.type}_ac${bestSim.ac}_alpha${bestSim.alpha}_rb${bestSim.rb}_cm${bestSim.cm.toExponential(2)}`,
                        phaseName,
                        _allResults:   response.results,
                    });
                }
            }
            // ────────────────────────────────────────────────────────────────
        }
    }

    if (progressEl) progressEl.textContent = 'Finalizing...';
    debugLog(`Classification complete: ${classificationResults.length} spectra fitted, ${totalCompared} candidate sims`);

    if (classificationResults.length === 0) {
        showStatus('No results — check filters', 'error');
        if (progressEl) progressEl.textContent = '';
        return;
    }

    if (progressEl) progressEl.textContent = '';

    document.getElementById('resultsSection').style.display = 'block';
    updateResultsPlots();
    updateBestFitDisplay();
    updateCellPopulationPlot();

    const modeLabel = localSimsInMemory
        ? (combinedInMemory ? ' [client-side, combined sims]' : ' [client-side]')
        : ' [server-side]';
    showStatus(`Classification complete: ${classificationResults.length} spectra fitted (${totalCompared} sims compared)${modeLabel}`, 'success');
}

/**
 * Returns true if simulationData contains any combined simulations.
 * When this is the case, classification must run client-side so combined
 * sims (which exist only in memory, not in the server DB) are considered.
 */
function _hasCombinedSimsLoaded() {
    const slots = ['inf', 'rup', 'wh', 'ran', 'apo'];
    return slots.some(slot =>
        (simulationData[slot] || []).some(s => s.isCombined)
    );
}

/**
 * Returns true if ANY simulations have been explicitly loaded into memory
 * via loadSimsForClassification().
 * This triggers client-side classification even without combined sims.
 */
function _hasLocalSimsLoaded() {
    const slots = ['inf', 'rup', 'wh', 'ran', 'apo'];
    return slots.some(slot => (simulationData[slot] || []).length > 0);
}

/**
 * Update the simFiltersPanel area in the Classification tab based on current mode.
 *
 * - Server-side mode: hide the notice banner, show the full filter panel (normal)
 * - Client-side mode (sims loaded via loadSimsForClassification): show a notice
 *   banner and hide the filter checkboxes (they were applied at load time)
 *
 * Uses a separate #simModeNotice div inserted before simFiltersPanel so the
 * filter panel HTML (with its checkboxes) is never destroyed and can be restored.
 *
 * Called after loadSimsForClassification() or clearLoadedSims().
 */
function updateClassificationModePanel() {
    const panel = document.getElementById('simFiltersPanel');
    if (!panel) return;

    // Ensure the notice div exists (insert it before simFiltersPanel on first call)
    let notice = document.getElementById('simModeNotice');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'simModeNotice';
        notice.style.cssText = 'display:none; margin-top:15px; padding:12px 15px; border-radius:8px; background:#f1f8e9; border:1px solid #a5d6a7;';
        panel.parentNode.insertBefore(notice, panel);
    }

    if (_hasLocalSimsLoaded()) {
        // Count loaded sims per slot
        const slots = ['wh', 'ran', 'inf', 'rup', 'apo'];
        const slotLabels = { wh: 'WH', ran: 'Ran', inf: 'Inf/Fus', rup: 'Rup', apo: 'Apo' };
        const counts = [];
        let total = 0;
        slots.forEach(slot => {
            const n = (simulationData[slot] || []).length;
            if (n > 0) { counts.push(`${slotLabels[slot]}: ${n}`); total += n; }
        });
        const hasCombined = _hasCombinedSimsLoaded();
        const combinedNote = hasCombined ? ' <span style="color:#e65100;">(includes combined sims)</span>' : '';

        notice.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                <span style="font-size:20px;">✅</span>
                <div style="flex:1;">
                    <div style="font-weight:600; color:#2e7d32; font-size:14px;">
                        Client-side mode — ${total.toLocaleString()} simulations in memory${combinedNote}
                    </div>
                    <div style="color:#555; font-size:12px; margin-top:3px;">${counts.join(' &nbsp;|&nbsp; ')}</div>
                    <div style="color:#777; font-size:12px; margin-top:2px;">
                        Parameter filters were applied during loading.
                        To change the simulation set, use the <strong>Simulation Selection</strong> panel in Data Loading.
                    </div>
                </div>
                <button class="button button-secondary" onclick="clearLoadedSims()" style="padding:5px 12px; font-size:12px; white-space:nowrap;">
                    ✖ Clear
                </button>
            </div>`;
        notice.style.display = 'block';
        // Hide the server-side filter checkboxes — not relevant in client-side mode
        panel.style.display = 'none';
    } else {
        // Server-side mode — hide notice, show filters if library is connected
        notice.style.display = 'none';
        if (serverLibrary.connected) {
            panel.style.display = 'block';
        }
    }
}

/**
 * Client-side classification — mirrors the server-side NumPy logic but runs
 * entirely in JS against the in-memory simulationData (including combined sims).
 *
 * @param {object} spectrum      - experimental spectrum { frequency[], magnitude[], phase[] }
 * @param {number} freq_min
 * @param {number} freq_max
 * @param {string} metric        - error metric name
 * @param {boolean} enableGrouping
 * @param {string[]} group_by    - fields to group on
 * @param {number|null} rConstrOverride
 * @returns {{ bestSim, distance, totalCompared, allResults }} or null if no sims
 */
function classifySpectrumLocally(
    spectrum, freq_min, freq_max, metric, enableGrouping, group_by, rConstrOverride
) {
    // Collect ALL sims from simulationData — user already pre-filtered during Load step.
    // We do not re-apply type checkboxes here; whatever is in memory is the candidate set.
    let candidateSims = [];
    const slots = ['wh', 'ran', 'inf', 'rup', 'apo'];
    slots.forEach(slot => {
        (simulationData[slot] || []).forEach(s => {
            if (!candidateSims.includes(s)) candidateSims.push(s);
        });
    });

    if (candidateSims.length === 0) {
        debugLog('classifySpectrumLocally: no candidate sims');
        return null;
    }

    debugLog(`classifySpectrumLocally: ${candidateSims.length} sims`);

    // Compute distance for every candidate sim
    const scored = candidateSims.map(sim => ({
        sim,
        distance: calculateDistance(sim, spectrum, freq_min, freq_max, metric),
    })).filter(s => isFinite(s.distance));

    if (scored.length === 0) return null;

    let finalCandidates = scored;

    // Groupby optimization (mirrors server-side logic)
    if (enableGrouping && group_by.length > 0) {
        // Build groups
        const groups = {};
        scored.forEach(s => {
            const key = getGroupKey(s.sim);
            if (!groups[key]) groups[key] = [];
            groups[key].push(s);
        });

        // Find best group (minimum distance within group)
        let bestKey = null, bestScore = Infinity;
        for (const [key, items] of Object.entries(groups)) {
            const minDist = Math.min(...items.map(i => i.distance));
            if (minDist < bestScore) { bestScore = minDist; bestKey = key; }
        }

        finalCandidates = groups[bestKey] || scored;
    }

    // Sort and take top 100
    finalCandidates.sort((a, b) => a.distance - b.distance);
    const top = finalCandidates.slice(0, 100);

    return {
        bestSim:      top[0].sim,
        distance:     top[0].distance,
        totalCompared: candidateSims.length,
        allResults:   top.map((s, i) => ({ rank: i + 1, sim: s.sim, distance: s.distance })),
    };
}

function getGroupKey(sim) {
    const useAc = document.getElementById('groupBy_ac').checked;
    const useAlpha = document.getElementById('groupBy_alpha').checked;
    const useRb = document.getElementById('groupBy_rb').checked;
    const useCm = document.getElementById('groupBy_cm').checked;
    const useType = document.getElementById('groupBy_type')?.checked || false;
    
    const parts = [];
    if (useType) {
        const simType = sim.type || sim.headerData?.simType || 'inf';
        parts.push(simType);
    }
    if (useAc) parts.push(`ac${sim.ac.toFixed(3)}`);
    if (useAlpha) parts.push(`alpha${sim.alpha.toFixed(3)}`);
    if (useRb) parts.push(`Rb${sim.rb.toFixed(3)}`);
    if (useCm) parts.push(`Cm${sim.cm.toExponential(2)}`);
    
    return parts.join('_') || 'all';
}

function calculateDistance(sim, spectrum, freq_min, freq_max, metric) {
    // Subtract sim's R_constr from experimental |Z| to compare impedance without constriction
    const rConstr = getRConstr(sim);

    // Get experimental data within frequency range, subtracting R_constr
    const expFreqs = [];
    const expMags = [];

    const isMagnitudeOnly = spectrum.magnitudeOnly === true;

    spectrum.frequency.forEach((f, i) => {
        if (f >= freq_min && f <= freq_max) {
            expFreqs.push(f);
            if (isMagnitudeOnly) {
                // No phase available — use raw |Z| directly (R_constr is NOT subtracted)
                expMags.push(spectrum.magnitude[i]);
            } else {
                // Decompose experimental |Z| into real/imag, subtract rConstr from real part
                const mag = spectrum.magnitude[i];
                const phRad = spectrum.phase[i] * Math.PI / 180;
                const zReal = mag * Math.cos(phRad) - rConstr;
                const zImag = mag * Math.sin(phRad);
                expMags.push(Math.sqrt(zReal * zReal + zImag * zImag));
            }
        }
    });

    if (expFreqs.length === 0) return Infinity;

    // Interpolate simulation to match experimental frequencies
    const simMags = expFreqs.map(expFreq => {
        const simFreqs = sim.frequency;
        const ascending = simFreqs[0] < simFreqs[simFreqs.length - 1];

        let iLow = 0, iHigh = simFreqs.length - 1;

        for (let i = 0; i < simFreqs.length - 1; i++) {
            const f1 = simFreqs[i];
            const f2 = simFreqs[i + 1];

            if ((ascending && f1 <= expFreq && f2 >= expFreq) ||
                (!ascending && f1 >= expFreq && f2 <= expFreq)) {
                iLow = i;
                iHigh = i + 1;
                break;
            }
        }

        // Logarithmic interpolation
        const f1 = Math.log10(simFreqs[iLow]);
        const f2 = Math.log10(simFreqs[iHigh]);
        const f = Math.log10(expFreq);
        const t = (f2 !== f1) ? Math.abs((f - f1) / (f2 - f1)) : 0;

        const z1 = sim.impedance[iLow];
        const z2 = sim.impedance[iHigh];

        if (isMagnitudeOnly) {
            // Add rConstr back to simulated real part so both sides include constriction resistance
            const realInterp = (z1.real + t * (z2.real - z1.real)) + rConstr;
            const imagInterp = z1.imag + t * (z2.imag - z1.imag);
            return Math.sqrt(realInterp * realInterp + imagInterp * imagInterp);
        } else {
            // Standard path: simulation impedance is raw (without R_constr)
            const realInterp = z1.real + t * (z2.real - z1.real);
            const imagInterp = z1.imag + t * (z2.imag - z1.imag);
            return Math.sqrt(realInterp * realInterp + imagInterp * imagInterp);
        }
    });

    return calculateErrorMetric(simMags, expMags, metric);
}

function calculateErrorMetric(simMags, expMags, metric) {
    let sum = 0;
    let count = 0;
    
    for (let i = 0; i < simMags.length && i < expMags.length; i++) {
        const sim = simMags[i];
        const exp = expMags[i];
        if (sim == null || exp == null || isNaN(sim) || isNaN(exp)) continue;
        
        switch (metric) {
            case 'rmse':
                sum += (sim - exp) ** 2;
                break;
            case 'mae':
                sum += Math.abs(sim - exp);
                break;
            case 'log_rmse':
                if (sim > 0 && exp > 0) {
                    sum += (Math.log10(sim) - Math.log10(exp)) ** 2;
                }
                break;
            case 'log_mae':
                if (sim > 0 && exp > 0) {
                    sum += Math.abs(Math.log10(sim) - Math.log10(exp));
                }
                break;
            case 'relerr':
                if (exp !== 0) {
                    sum += Math.abs((sim - exp) / exp);
                }
                break;
        }
        count++;
    }
    
    if (count === 0) return Infinity;
    
    if (metric === 'rmse' || metric === 'log_rmse') {
        return Math.sqrt(sum / count);
    }
    return sum / count;
}

/**
 * Return the time [h] of each stage boundary inferred from classificationResults.
 * A boundary exists wherever phaseName changes between consecutive spectra in any channel.
 * Returns sorted, deduplicated array (empty when no stages).
 */
function _getStageBoundaryHours() {
    if (!classificationResults.some(r => r.phaseName)) return [];
    const channels = [...new Set(classificationResults.map(r => r.channel))];
    const boundaries = new Set();
    channels.forEach(ch => {
        const sorted = classificationResults
            .filter(r => r.channel === ch)
            .sort((a, b) => a.time - b.time);
        for (let i = 0; i < sorted.length - 1; i++) {
            if (sorted[i].phaseName !== sorted[i + 1].phaseName) {
                const mid = (sorted[i].timeHours + sorted[i + 1].timeHours) / 2;
                boundaries.add(Math.round(mid * 1000) / 1000);
            }
        }
    });
    return [...boundaries].sort((a, b) => a - b);
}

/**
 * Build one Plotly scatter trace per stage boundary.
 * Uses a hidden y2 axis (0–1 paper range) so lines span full plot height
 * and appear in the legend for toggling.
 * Only the first trace shows a legend entry; all share legendgroup 'stageBoundary'.
 */
function _stageBoundaryTraces() {
    return _getStageBoundaryHours().map((t, i) => ({
        x: [t, t],
        y: [0, 1],
        yaxis: 'y2',
        mode: 'lines',
        type: 'scatter',
        name: 'Stage boundaries',
        legendgroup: 'stageBoundary',
        showlegend: i === 0,
        line: { color: '#555', width: 1.5, dash: 'dot' },
        hovertemplate: `<b>Stage boundary</b><br>t = ${t.toFixed(2)} h<extra></extra>`,
    }));
}

function updateResultsPlots() {
    if (classificationResults.length === 0) return;

    // Group by channel — use user-set colors (respects color picker in channel config)
    const channels = [...new Set(classificationResults.map(r => r.channel))];
    const colors = channels.map(ch => getChannelColor(ch));

    // Summed distance plot
    const distanceTraces = channels.map((ch, idx) => {
        const chResults = classificationResults.filter(r => r.channel === ch)
            .sort((a, b) => a.time - b.time);

        return {
            x: chResults.map(r => r.timeHours),
            y: chResults.map(r => r.distance),
            mode: 'lines+markers',
            name: ch,
            line: { color: colors[idx], width: 2 },
            marker: { size: 6 }
        };
    });

    Plotly.newPlot('plotDistanceSum', [...distanceTraces, ..._stageBoundaryTraces()], {
        title: 'Classification Distance vs Time',
        xaxis: { title: 'Time [h]' },
        yaxis: { title: 'Distance', type: 'log' },
        yaxis2: { overlaying: 'y', range: [0, 1], visible: false, fixedrange: true },
        margin: { l: 60, r: 20, t: 40, b: 50 },
        showlegend: true,
        responsive: true, toImageButtonOptions: { format: 'png', scale: 3 }
    });
    
    // Superposition plot - show experimental vs best fit
    const timepointSelection = document.getElementById('superpositionTimepoint').value;
    const superTraces = [];

    channels.forEach((ch, idx) => {
        const chResults = classificationResults.filter(r => r.channel === ch)
            .sort((a, b) => a.time - b.time);

        if (chResults.length === 0) return;

        // Determine which timepoints to show
        let resultsToPlot = [];
        if (timepointSelection === 'first') {
            resultsToPlot = [chResults[0]];
        } else if (timepointSelection === 'last') {
            resultsToPlot = [chResults[chResults.length - 1]];
        } else { // 'all'
            resultsToPlot = chResults;
        }

        resultsToPlot.forEach((result, ridx) => {
            const spectrum = result.spectrum;

            // Experimental data displayed as-is (raw |Z| includes physical R_constr from electrode)
            const expMagDisplay = spectrum.magnitude;

            // Use different opacity for multiple timepoints
            const opacity = timepointSelection === 'all' ? 0.7 : 1;

            superTraces.push({
                x: spectrum.frequency,
                y: expMagDisplay,
                mode: 'lines+markers',
                name: `${ch} @ ${result.timeHours.toFixed(1)}h (exp)`,
                line: { color: colors[idx], width: 2 },
                marker: { size: 4 },
                opacity: opacity
            });

            // Best fit - add sim's R_constr so it matches the experimental (which has physical R_constr)
            if (result.bestSim) {
                const sim = result.bestSim;
                const simRConstr = getRConstr(sim);
                const simMag = sim.impedance.map(z =>
                    Math.sqrt((z.real + simRConstr)**2 + z.imag**2)
                );
                
                const fitLabel = `fit ${ch} ${result.timeHours.toFixed(3)}h`;
                const hoverText = getSimHoverText(sim);
                
                superTraces.push({
                    x: sim.frequency,
                    y: simMag,
                    mode: 'lines',
                    name: fitLabel,
                    line: { color: colors[idx], width: 2, dash: 'dash' },
                    opacity: opacity,
                    hovertemplate: `%{y:.3e}<br>${hoverText}<extra></extra>`
                });
            }
        });
    });
    
    const titleSuffix = timepointSelection === 'all' ? ' (all timepoints)' : 
                      timepointSelection === 'first' ? ' (first timepoint)' : ' (last timepoint)';
    
    Plotly.newPlot('plotSuperposition', superTraces, {
        title: 'Experimental vs Best Fit' + titleSuffix,
        xaxis: { title: 'Frequency [Hz]', type: 'log' },
        yaxis: { title: '|Z| [Ω]', type: 'log' },
        margin: { l: 60, r: 20, t: 40, b: 50 },
        responsive: true, toImageButtonOptions: { format: 'png', scale: 3 },
        showlegend: true
    });
    
    // Cell population plot - PERCENTAGE based
    updateCellPopulationPlot();
}

/**
 * Build (or rebuild) apo stage checkboxes inside #apoStageTogglesRow.
 * Skips rebuild when the stage label set has not changed.
 */
function _buildApoStageToggles(stageLabels) {
    const container = document.getElementById('apoStageTogglesRow');
    if (!container) return;
    const tag = stageLabels.join('|');
    if (container.dataset.built === tag) return;
    container.dataset.built = tag;
    const _cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    container.innerHTML = stageLabels.map(lbl =>
        `<label><input type="checkbox" id="showApoStage_${lbl}" checked onchange="updateCellPopulationPlot()"> ${_cap(lbl)} stage</label>`
    ).join('');
}

// ---------------------------------------------------------------------------
// Read figsize control and convert matplotlib inches → pixels at 96 dpi
// ---------------------------------------------------------------------------
function _getCellPopFigsize() {
    const preset = document.getElementById('cellPopFigsizePreset')?.value ?? 'auto';
    if (preset === 'auto') return {};
    let w, h;
    if (preset === 'custom') {
        w = parseFloat(document.getElementById('cellPopFigsizeW')?.value) || 12;
        h = parseFloat(document.getElementById('cellPopFigsizeH')?.value) || 5;
    } else {
        [w, h] = preset.split('x').map(Number);
    }
    return { width: Math.round(w * 96), height: Math.round(h * 96), autosize: false };
}

function updateCellPopulationPlot() {
    if (classificationResults.length === 0) return;

    const channels = [...new Set(classificationResults.map(r => r.channel))];
    const colors = channels.map(ch => getChannelColor(ch));

    // Check toggle states
    const showAlive = document.getElementById('showAlive')?.checked ?? true;
    const showDead = document.getElementById('showDead')?.checked ?? true;
    const showOnElectrode = document.getElementById('showOnElectrode')?.checked ?? true;
    const showFused = document.getElementById('showFused')?.checked ?? true;

    // Detect which categories exist in data
    const hasAlive = classificationResults.some(r => r.bestSim?.headerData?.aliveCells > 0);
    const hasDead = classificationResults.some(r => r.bestSim?.headerData?.deadCells > 0);
    const hasFused = classificationResults.some(r => r.bestSim?.headerData?.fusedCells > 0);
    const hasCellsOnElec = classificationResults.some(r => r.bestSim?.headerData?.cellsOnElectrode > 0);

    // Detect apoptosis stage data
    const hasApo = classificationResults.some(r => (r.bestSim?.headerData?.apoStages?.length ?? 0) > 0);
    const _firstApoResult = hasApo ? classificationResults.find(r => (r.bestSim?.headerData?.apoStages?.length ?? 0) > 0) : null;
    const apoStageLabels = _firstApoResult ? _firstApoResult.bestSim.headerData.apoStages.map(s => s.label) : [];
    const _apoStagePalette = ['#3498db', '#9b59b6', '#f39c12', '#e67e22', '#1abc9c', '#e74c3c', '#2c3e50', '#8e44ad'];

    // Build apo stage checkboxes and show/hide their containers
    if (hasApo) _buildApoStageToggles(apoStageLabels);
    const apoStageRow = document.getElementById('apoStageTogglesRow');
    const allApoSpan  = document.getElementById('allApoToggleSpan');
    if (apoStageRow) apoStageRow.style.display = hasApo ? 'contents' : 'none';
    if (allApoSpan)  allApoSpan.style.display  = hasApo ? '' : 'none';

    // Check if any inf simulations are loaded or if there are fused cells
    const hasInfSimulations = simulationData.inf.length > 0;
    const showFusedOption = hasInfSimulations || hasFused;

    // Show/hide fused checkbox based on relevance
    const fusedContainer = document.getElementById('fusedToggleContainer');
    if (fusedContainer) {
        fusedContainer.style.display = showFusedOption ? 'inline' : 'none';
    }

    const allTraces = [];

    channels.forEach((ch, idx) => {
        const chResults = classificationResults.filter(r => r.channel === ch)
            .sort((a, b) => a.time - b.time);

        const times = chResults.map(r => r.timeHours);
        const total = chResults[0]?.bestSim?.headerData?.totalCells;
        const total_elec = chResults[0]?.bestSim?.headerData?.electrodeCells;

        if (hasAlive && showAlive) {
            allTraces.push({
                x: times,
                y: chResults.map(r => (r.bestSim?.headerData?.aliveCells || 0) / total * 100),
                mode: 'lines+markers', name: `${ch} Alive`,
                line: { color: colors[idx], width: 2 },
                marker: { size: 6 }
            });
        }
        if (hasDead && showDead) {
            allTraces.push({
                x: times,
                y: chResults.map(r => (r.bestSim?.headerData?.deadCells || 0) / total * 100),
                mode: 'lines+markers', name: `${ch} Dead`,
                line: { color: colors[idx], width: 2, dash: 'dot' },
                marker: { size: 6, symbol: 'x' }
            });
        }
        if (hasFused && showFused) {
            allTraces.push({
                x: times,
                y: chResults.map(r => (r.bestSim?.headerData?.fusedCells || 0) / total * 100),
                mode: 'lines+markers', name: `${ch} Fused`,
                line: { color: colors[idx], width: 2, dash: 'dash' },
                marker: { size: 6, symbol: 'triangle-up' }
            });
        }
        if (hasCellsOnElec && showOnElectrode) {
            allTraces.push({
                x: times,
                y: chResults.map(r => {
                    const cellsOnElec = r.bestSim?.headerData?.cellsOnElectrode || 0;
                    const electrodeCells = r.bestSim?.headerData?.electrodeCells || 1;
                    return (cellsOnElec / electrodeCells) * 100;
                }),
                mode: 'lines+markers', name: `${ch} Electrode Coverage`,
                line: { color: colors[idx], width: 2, dash: 'dashdot' },
                marker: { size: 6, symbol: 'square' }
            });
        }

        // Apoptosis stage traces
        if (hasApo) {
            apoStageLabels.forEach((lbl, si) => {
                const showStage = document.getElementById(`showApoStage_${lbl}`)?.checked ?? true;
                if (!showStage) return;
                allTraces.push({
                    x: times,
                    y: chResults.map(r => (r.bestSim?.headerData?.apoStages?.[si]?.count || 0) / (total || 1) * 100),
                    mode: 'lines+markers',
                    name: `${ch} Apo ${lbl.charAt(0).toUpperCase() + lbl.slice(1)}`,
                    line: { color: _apoStagePalette[si % _apoStagePalette.length], width: 2, dash: 'dot' },
                    marker: { size: 6, symbol: 'diamond' }
                });
            });

            const showAllApo = document.getElementById('showAllApo')?.checked ?? true;
            if (showAllApo) {
                allTraces.push({
                    x: times,
                    y: chResults.map(r => {
                        const stages = r.bestSim?.headerData?.apoStages || [];
                        return stages.reduce((sum, s) => sum + s.count, 0) / (total || 1) * 100;
                    }),
                    mode: 'lines+markers',
                    name: `${ch} All Apoptosis`,
                    line: { color: '#c0392b', width: 2, dash: 'dash' },
                    marker: { size: 6, symbol: 'circle-open' }
                });
            }
        }
    });
    
    if (allTraces.length > 0) {
        Plotly.newPlot('plotCellPopulation', [...allTraces, ..._stageBoundaryTraces()], {
            title: 'Cell Population Evolution (% of total)',
            xaxis: { title: 'Time [h]' },
            yaxis: { title: 'Percentage [%]', range: [0, 100] },
            yaxis2: { overlaying: 'y', range: [0, 1], visible: false, fixedrange: true },
            margin: { l: 60, r: 20, t: 40, b: 50 },
            responsive: true, toImageButtonOptions: { format: 'png', scale: 3 },
            showlegend: true,
            ..._getCellPopFigsize()
        });
    } else {
        Plotly.newPlot('plotCellPopulation', [], {
            title: 'Cell Population Evolution (no data selected)',
            margin: { l: 60, r: 20, t: 40, b: 50 },
            ..._getCellPopFigsize()
        });
    }
}


// ---------------------------------------------------------------------------
// Toggle groupby sub-options (including Evolution Stages) when checkbox changes
// ---------------------------------------------------------------------------
function toggleGroupingOptions() {
    const enabled = document.getElementById('enableGrouping').checked;
    const opts = document.getElementById('groupingOptions');
    if (opts) opts.style.display = enabled ? 'block' : 'none';
}

// ---------------------------------------------------------------------------
// Best Fit Results — two display modes: General (matrix table) / Detail (per-spectrum)
// ---------------------------------------------------------------------------
function updateBestFitDisplay() {
    const container = document.getElementById('bestFitContent');
    if (!container) return;

    const channels  = [...new Set(classificationResults.map(r => r.channel))];
    const hasStages = classificationResults.some(r => r.phaseName);
    const mode      = document.querySelector('input[name="bestFitMode"]:checked')?.value ?? 'general';

    if (mode === 'general') {
        // ── General: styled card layout — one wide card per channel ──────────
        // Grid columns inside each card: (stage?) | type | α | Rb | Cm | ac | param
        const innerCols = hasStages
            ? '72px 62px 1fr 1fr 1.2fr 1fr 1fr'
            : '62px 1fr 1fr 1.2fr 1fr 1fr';
        const gridStyle = `display:grid; grid-template-columns:${innerCols}; align-items:center; gap:5px 12px;`;
        const hCell = (t, sub) =>
            `<div style="font-size:11px; font-weight:700; color:#555; text-align:center;">${t}${sub ? `<br><small style="font-weight:400;color:#888;">${sub}</small>` : ''}</div>`;

        let html = `<div style="display:flex; flex-direction:column; gap:8px;">`;

        // ── Header card ───────────────────────────────────────────────────────
        html += `<div style="display:flex; align-items:center; background:#eef1fc; border-radius:8px; padding:8px 16px 8px 10px; border:1.5px solid #c5cef5;">
            <div style="width:80px; flex-shrink:0; font-size:11px; font-weight:700; color:#667eea;">Channel</div>
            <div style="${gridStyle} flex:1;">
                ${hasStages ? hCell('Stage') : ''}
                ${hCell('Type')}
                ${hCell('α', '√Ω·cm')}
                ${hCell('Rb', 'Ω·cm²')}
                ${hCell('Cm', 'F/cm²')}
                ${hCell('ac', 'µm²')}
                ${hCell('Param')}
            </div>
        </div>`;

        // ── One card per channel ──────────────────────────────────────────────
        channels.forEach(ch => {
            const chResults = classificationResults
                .filter(r => r.channel === ch)
                .sort((a, b) => a.time - b.time);
            const chColor = getChannelColor(ch);

            html += `<div style="display:flex; align-items:stretch; background:white; border-radius:10px; border:1.5px solid #dde3f5; box-shadow:0 2px 8px rgba(100,120,200,0.08); overflow:hidden;">
                <div style="width:80px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:${chColor}14; border-right:2px solid ${chColor}33; font-weight:700; font-size:13px; color:${chColor}; padding:8px 4px; text-align:center;">${ch}</div>
                <div style="flex:1;">`;

            if (hasStages) {
                const stageNames = [...new Set(chResults.map(r => r.phaseName).filter(Boolean))];
                stageNames.forEach((stageName, stIdx) => {
                    const sr         = chResults.filter(r => r.phaseName === stageName);
                    const sims       = sr.map(r => r.bestSim).filter(Boolean);
                    const stageColor = `hsl(${stIdx * 60}, 70%, 35%)`;
                    const isLast     = stIdx === stageNames.length - 1;
                    html += `<div style="${gridStyle} padding:8px 16px; ${isLast ? '' : 'border-bottom:1px solid #f0f3fc;'}">
                        <div style="font-size:11px; font-weight:600; color:${stageColor}; border-left:3px solid ${stageColor}; padding-left:5px;">${stageName}</div>
                        ${_bestFitMatrixCells(sims)}
                    </div>`;
                });
            } else {
                const sims = chResults.map(r => r.bestSim).filter(Boolean);
                html += `<div style="${gridStyle} padding:8px 16px;">${_bestFitMatrixCells(sims)}</div>`;
            }

            html += `</div></div>`; // close inner + outer card
        });

        html += `</div>`;
        container.innerHTML = html;
        return;
    }

    // ── Detail mode: per-channel flex cards ───────────────────────────────────
    let html = `<div style="display: flex; flex-wrap: wrap; gap: 15px;">`;

    channels.forEach(ch => {
        const chResults = classificationResults
            .filter(r => r.channel === ch)
            .sort((a, b) => a.time - b.time);

        html += `<div style="flex: 1; min-width: 280px; max-width: 460px; background: white; padding: 14px; border-radius: 8px; border: 1px solid #ddd;">
            <h4 style="color: #667eea; margin: 0 0 10px 0; border-bottom: 2px solid #667eea; padding-bottom: 5px;">${ch}</h4>`;

        if (hasStages) {
            const stageNames = [...new Set(chResults.map(r => r.phaseName).filter(Boolean))];
            stageNames.forEach((stageName, idx) => {
                const sr       = chResults.filter(r => r.phaseName === stageName);
                const color    = `hsl(${idx * 60}, 70%, 40%)`;
                const groupKey = sr[0]?.groupKey || 'N/A';
                html += `<div style="margin-bottom: 10px;">
                    <div style="font-weight: 600; font-size: 12px; color: ${color}; border-left: 3px solid ${color}; padding-left: 8px; margin-bottom: 5px;">
                        ${stageName} <span style="font-weight: normal; color: #666;">(${groupKey})</span>
                    </div>
                    <div style="max-height: 120px; overflow-y: auto; padding-left: 11px;">`;
                sr.forEach(r => {
                    if (r.bestSim) {
                        html += `<div style="font-size: 10px; padding: 2px 4px; background: #f8f8f8; margin: 1px 0; border-radius: 2px; display: flex; justify-content: space-between; gap: 5px;">
                            <span><strong>${r.timeHours.toFixed(1)}h</strong></span>
                            <span>${getSimShortDisplay(r.bestSim)} α=${r.bestSim.alpha.toFixed(2)} Rb=${r.bestSim.rb.toFixed(1)} Cm=${r.bestSim.cm.toExponential(1)}</span>
                            <span style="color: #888;">d=${r.distance.toExponential(1)}</span>
                        </div>`;
                    }
                });
                html += `</div></div>`;
            });
        } else {
            html += `<div style="max-height: 220px; overflow-y: auto;">`;
            chResults.forEach(r => {
                if (r.bestSim) {
                    html += `<div style="font-size: 11px; padding: 4px 6px; background: #f8f8f8; margin: 2px 0; border-radius: 3px; display: flex; justify-content: space-between; gap: 6px;">
                        <span><strong>${r.timeHours.toFixed(1)}h:</strong></span>
                        <span>${getSimShortDisplay(r.bestSim)} α=${r.bestSim.alpha.toFixed(2)} Rb=${r.bestSim.rb.toFixed(1)} Cm=${r.bestSim.cm.toExponential(1)}</span>
                        <span style="color: #888; white-space: nowrap;">d=${r.distance.toExponential(1)}</span>
                    </div>`;
                }
            });
            html += `</div>`;
        }

        html += `</div>`;
    });

    html += `</div>`;
    container.innerHTML = html;
}

/**
 * Build 6 <div> grid cells for one row of the General mode card layout.
 * Returns HTML for: Type | α | Rb | Cm | ac | Param
 * Single value when groupby is active; (min, max) range otherwise.
 */
function _bestFitMatrixCells(sims) {
    if (!sims || sims.length === 0) {
        return `<div style="grid-column:1/-1; color:#aaa; font-style:italic; font-size:11px; text-align:center; padding:4px 0;">No results</div>`;
    }

    const fmt3 = v => parseFloat(v.toPrecision(3)).toString();
    const fmtE = v => v.toExponential(2);
    // Deduplicate with 4 sig-fig rounding to absorb float noise
    const uniq = arr => [...new Set(arr.map(v => parseFloat(v.toPrecision(4))))].sort((a, b) => a - b);
    const rng  = (arr, fmtFn) => {
        const u = uniq(arr);
        return u.length === 1
            ? fmtFn(u[0])
            : `<span style="color:#888; font-size:10px;">(${fmtFn(u[0])},&nbsp;${fmtFn(u[u.length - 1])})</span>`;
    };

    const types = [...new Set(sims.map(s => s.type))].sort();

    // Per-type varying parameter range (Per%, WH Stage, …)
    const paramParts = types.map(t => {
        const ts        = sims.filter(s => s.type === t);
        const paramName = typeof getVaryingParamName === 'function' ? getVaryingParamName(t) : null;
        if (!paramName) return '';
        const vals = ts.map(s => s.step).filter(v => v != null && isFinite(v));
        return vals.length ? rng(vals, fmt3) : '';
    }).filter(Boolean);

    const div = (content, extra = '') =>
        `<div style="font-size:11px; text-align:center;${extra}">${content}</div>`;

    return [
        div(types.join(' / '), ' font-weight:600;'),
        div(rng(sims.map(s => s.alpha), fmt3)),
        div(rng(sims.map(s => s.rb),    fmt3)),
        div(rng(sims.map(s => s.cm),    fmtE)),
        div(rng(sims.map(s => s.ac),    fmt3)),
        div(paramParts.join(' / ') || '—'),
    ].join('');
}

function exportResults() {
    if (classificationResults.length === 0) {
        showStatus('Run classification first', 'error');
        return;
    }
    
    const metric = document.querySelector('input[name="errorMetric"]:checked').value;
    const hasPhases = classificationResults.some(r => r.phaseName);
    const separator = document.getElementById('csvSeparator')?.value || ',';
    const sep = separator === '\\t' ? '\t' : separator;
    
    // Check if any results have combined simulations
    const hasCombined = classificationResults.some(r => r.bestSim?.isCombined);

    // Detect apoptosis stage labels (from first result carrying apoStages)
    const _firstApoRes = classificationResults.find(r => (r.bestSim?.headerData?.apoStages?.length ?? 0) > 0);
    const apoExportLabels = _firstApoRes ? _firstApoRes.bestSim.headerData.apoStages.map(s => s.label) : [];
    const hasApoExport = apoExportLabels.length > 0;
    const apoExtraHeaders = hasApoExport ? [...apoExportLabels.map(l => `ApoStage_${l}`), 'ApoTotal'] : [];

    // Header - add Param1, Param2, IsCombined columns
    const baseHeaders = ['Channel', 't_Hs', 't_Sec', 'ac', 'Alpha', 'Rb', 'Cm', 'SimType', 'Param1', 'Param2', 'IsCombined', 'Distance', 'Metric', 'TotalCells', 'AliveCells', 'DeadCells', 'CellsOnElec', 'FusedCells', ...apoExtraHeaders];
    const headers = hasPhases
        ? ['Channel', 'Phase', ...baseHeaders.slice(1)]
        : baseHeaders;

    let csv = headers.join(sep) + '\n';

    classificationResults.forEach(r => {
        if (r.bestSim) {
            const sim = r.bestSim;
            const simType = sim.headerData?.simType || sim.type || 'inf';
            const isCombined = sim.isCombined ? 'yes' : 'no';

            // Get param values
            let param1, param2;
            if (sim.isCombined && sim.param1 !== undefined && sim.param2 !== undefined) {
                param1 = sim.param1;
                param2 = sim.param2;
            } else {
                param1 = getVaryingParamValue(sim, simType);
                param2 = (simType === 'apo') ? (sim.per ?? '') : '';
            }

            const hd = sim.headerData || {};
            const totalCells = hd.totalCells || 729;
            const aliveCells = hd.aliveCells || 0;
            const deadCells = hd.deadCells || 0;
            const cellsOnElectrode = hd.cellsOnElectrode || 0;
            const fusedCells = hd.fusedCells || 0;

            // Apo stage values (ordered by apoExportLabels)
            const apoValues = hasApoExport
                ? [
                    ...apoExportLabels.map(l => (hd.apoStages?.find(s => s.label === l)?.count ?? 0)),
                    (hd.apoStages?.reduce((sum, s) => sum + s.count, 0) ?? 0)
                  ]
                : [];

            const commonTail = [simType, param1, param2, isCombined, r.distance.toFixed(5), metric, totalCells, aliveCells, deadCells, cellsOnElectrode, fusedCells, ...apoValues];
            const row = hasPhases
                ? [r.channel, r.phaseName || '', r.timeHours.toFixed(3), r.time.toFixed(3), sim.ac, sim.alpha, sim.rb, sim.cm.toExponential(2), ...commonTail]
                : [r.channel, r.timeHours.toFixed(3), r.time.toFixed(3), sim.ac, sim.alpha, sim.rb, sim.cm.toExponential(2), ...commonTail];

            csv += row.join(sep) + '\n';
        }
    });
    
    const extension = sep === '\t' ? 'tsv' : 'csv';
    const mimeType = sep === '\t' ? 'text/tab-separated-values' : 'text/csv';
    
    const blob = new Blob([csv], { type: `${mimeType};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `classification_results_${new Date().toISOString().slice(0,10)}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showStatus('Results exported', 'success');
}
// ============================================================
