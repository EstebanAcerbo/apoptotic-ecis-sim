// ============================================================
// ECIS CLASSIFIER - SIMULATION COMBINATION MODULE
// ============================================================
// Combines simulations for dual-electrode configurations.
// Creates Cartesian product of simulations within parameter groups.
// Combined impedance: Z_total = Z_electrode1 + Z_electrode2
//
// Key functions:
// - combineSimulations(): Generate all combinations
// - combineTwoSimulations(): Add impedances of two simulations
// - resetSimulations(): Restore original uncombined data
// - getSimHoverText(): Format simulation info for tooltips
// ============================================================

function toggleCombinationOptions() {
    const enabled = document.getElementById('enableCombination').checked;
    document.getElementById('combinationOptions').style.display = enabled ? 'block' : 'none';
    // Do NOT call updateCombinePreview() here — the panel only updates when
    // the user presses "Load Simulations", so the cards reflect what was actually loaded.
}

function updateCombinePreview() {
    const enableCombination = document.getElementById('enableCombination')?.checked;
    const combCard  = document.getElementById('previewCombCard');
    const totalCard = document.getElementById('previewTotalCard');
    const gridEl    = document.getElementById('combinePreviewContent');
    const detailsDiv = document.getElementById('combinePreviewDetails');

    // Show/hide the last 2 cards and adjust grid columns based on combination state.
    // Without combination: only Groups + Original (2 cols).
    // With combination: all 4 cards (4 cols).
    const showAll = !!enableCombination;
    if (combCard)  combCard.style.display  = showAll ? '' : 'none';
    if (totalCard) totalCard.style.display = showAll ? '' : 'none';
    if (gridEl)    gridEl.style.gridTemplateColumns = showAll ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)';

    const enabledRawTypes = _getEnabledCombineTypes();
    const enabledSlots    = [...new Set(enabledRawTypes.map(_typeToSlot))];

    // --- Case 1: local data already fetched → compute exact preview ---
    // After _executeCombineLogic() runs, simulationData slots contain ONLY combined
    // sims (originals are replaced).  Use originalSimulationData when available so
    // the preview always reflects the raw (uncombined) input counts.
    let simsToProcess = [];
    enabledSlots.forEach(slot => {
        const src = (originalSimulationData && originalSimulationData[slot])
            ? originalSimulationData[slot]
            : (simulationData[slot] || []);
        simsToProcess = simsToProcess.concat(
            src.filter(s => !s.isCombined).map(s => ({...s, type: slot}))
        );
    });
    if (simsToProcess.length > 0) {
        // Always compute groups + original count
        const groups = {};
        simsToProcess.forEach(sim => {
            const key = getCombineGroupKey(sim);
            if (!groups[key]) groups[key] = [];
            groups[key].push(sim);
        });
        const numGroups = Object.keys(groups).length;

        document.getElementById('previewGroups').textContent   = numGroups;
        document.getElementById('previewOriginal').textContent = simsToProcess.length.toLocaleString('en-US');

        if (!enableCombination) {
            // Only 2 cards visible — skip combination math entirely
            if (detailsDiv) detailsDiv.innerHTML = '';
            return;
        }

        // Combination enabled → compute cartesian product counts
        let totalCombinations = 0;
        const groupDetails = [];
        Object.entries(groups).forEach(([key, sims]) => {
            const n = sims.length;
            const combsInGroup = n * (n + 1) / 2;
            totalCombinations += combsInGroup;
            if (n > 1) groupDetails.push(`${key}: ${n}→${combsInGroup}`);
        });
        // Combinations REPLACE originals (simulationData[slot] = combined only),
        // so the total sims available for classification = totalCombinations.
        const totalAfter = totalCombinations;

        document.getElementById('previewCombinations').textContent = totalCombinations.toLocaleString('en-US');
        document.getElementById('previewTotal').textContent        = totalAfter.toLocaleString('en-US');

        if (groupDetails.length > 0) {
            const shown = groupDetails.slice(0, 5);
            const extra = groupDetails.length > 5 ? ` <em>…+${groupDetails.length - 5} more</em>` : '';
            detailsDiv.innerHTML = `<strong>Groups:</strong> ${shown.join(' | ')}${extra}`;
        } else {
            detailsDiv.innerHTML = '<em>No groups with >1 sim — nothing to combine</em>';
        }
        return;
    }

    // --- Case 2: no local data yet ---
    document.getElementById('previewGroups').textContent   = '?';
    document.getElementById('previewOriginal').textContent = '…';

    if (!enableCombination) {
        // Only 2 cards shown — no server query needed
        if (detailsDiv) detailsDiv.innerHTML = '';
        return;
    }

    // Combination enabled but no local data → query server for estimate
    document.getElementById('previewCombinations').textContent = '?';
    document.getElementById('previewTotal').textContent        = '?';

    if (!serverLibrary.connected || enabledRawTypes.length === 0) {
        detailsDiv.innerHTML = '<em>Connect to library and select simulation types to preview</em>';
        return;
    }

    detailsDiv.innerHTML = '<em>Fetching server count…</em>';

    // Query each type separately to show breakdown
    // Only query types that actually exist in the DB
    const availableTypes = serverLibrary.params?.types ?? [];
    const queryTypes = enabledRawTypes.filter(t => availableTypes.includes(t));

    if (queryTypes.length === 0) {
        document.getElementById('previewOriginal').textContent = '0';
        document.getElementById('previewGroups').textContent   = '0';
        document.getElementById('previewCombinations').textContent = '0';
        document.getElementById('previewTotal').textContent    = '0';
        detailsDiv.innerHTML = `<em style="color:#c62828">None of the selected types (${enabledRawTypes.join(', ')}) exist in the database.</em>`;
        return;
    }

    const loadFilters = (typeof _getLoadFilters === 'function') ? _getLoadFilters() : {};
    Promise.all(queryTypes.map(type =>
        apiFilterSimulations({
            types:       [type],
            de_um:       loadFilters.de_um?.length       ? loadFilters.de_um       : undefined,
            acpe:        loadFilters.acpe?.length        ? loadFilters.acpe        : undefined,
            ncpe:        loadFilters.ncpe?.length        ? loadFilters.ncpe        : undefined,
            ac:          loadFilters.ac?.length          ? loadFilters.ac          : undefined,
            alpha:       loadFilters.alpha?.length       ? loadFilters.alpha       : undefined,
            rb:          loadFilters.rb?.length          ? loadFilters.rb          : undefined,
            cm:          loadFilters.cm?.length          ? loadFilters.cm          : undefined,
            cell_shapes: loadFilters.cell_shapes?.length ? loadFilters.cell_shapes : undefined,
            hw_ratios:   loadFilters.hw_ratios?.length   ? loadFilters.hw_ratios   : undefined,
        }).then(r => ({ type, count: r.count }))
    )).then(results => {
        const totalSims = results.reduce((s, r) => s + r.count, 0);
        document.getElementById('previewOriginal').textContent = totalSims.toLocaleString('en-US');

        // Estimate groups from serverLibrary.params (unique ac×alpha×rb×cm combos)
        // This is an upper bound — actual groups depend on which combos exist per type
        const useAc    = document.getElementById('combineBy_ac')?.checked;
        const useAlpha = document.getElementById('combineBy_alpha')?.checked;
        const useRb    = document.getElementById('combineBy_rb')?.checked;
        const useCm    = document.getElementById('combineBy_cm')?.checked;
        const p = serverLibrary.params;
        const estGroups =
            (useAc    ? (p?.ac?.length    ?? 1) : 1) *
            (useAlpha ? (p?.alpha?.length ?? 1) : 1) *
            (useRb    ? (p?.rb?.length    ?? 1) : 1) *
            (useCm    ? (p?.cm?.length    ?? 1) : 1);

        // Average sims per group × combinations per group
        const avgPerGroup = totalSims / Math.max(estGroups, 1);
        const estCombos   = Math.round(estGroups * avgPerGroup * avgPerGroup);
        const estTotal    = totalSims + estCombos;

        document.getElementById('previewGroups').textContent       = `≈ ${estGroups.toLocaleString('en-US')}`;
        document.getElementById('previewCombinations').textContent = `≈ ${estCombos.toLocaleString('en-US')}`;
        document.getElementById('previewTotal').textContent        = `≈ ${estTotal.toLocaleString('en-US')}`;

        const notInDB = enabledRawTypes.filter(t => !availableTypes.includes(t));
        const breakdown = results.map(r => `${r.type}: ${r.count.toLocaleString('en-US')}`).join(' | ');
        const warning   = notInDB.length ? `<br><em style="color:#e65100">Not in DB: ${notInDB.join(', ')}</em>` : '';
        detailsDiv.innerHTML = `<em>${breakdown}</em>${warning}<br>
            <em style="color:#888">~estimates — exact counts after "Generate Combinations".</em>`;
    }).catch(err => {
        detailsDiv.innerHTML = `<em style="color:red">Error querying server: ${err.message}</em>`;
    });
}

function getCombineGroupKey(sim) {
    const useAc = document.getElementById('combineBy_ac').checked;
    const useAlpha = document.getElementById('combineBy_alpha').checked;
    const useRb = document.getElementById('combineBy_rb').checked;
    const useCm = document.getElementById('combineBy_cm').checked;
    const useDe = document.getElementById('combineBy_de')?.checked;

    const parts = [];
    if (useAc) parts.push(`ac${sim.ac.toFixed(3)}`);
    if (useAlpha) parts.push(`Î±${sim.alpha.toFixed(3)}`);
    if (useRb) parts.push(`Rb${sim.rb.toFixed(3)}`);
    if (useCm) parts.push(`Cm${sim.cm.toExponential(2)}`);
    if (useDe) parts.push(`de${sim.de_um ?? sim.deUm ?? ''}`);

    return parts.join('_') || 'all';
}

function getVaryingParamName(type) {
    // Return the name of the parameter that varies within groups for each type
    switch(type) {
        case 'inf': return 'step';
        case 'rup': return 'step';
        case 'wh': return 'WH';
        case 'ran': return 'Per';
        default: return 'step';
    }
}

function getVaryingParamValue(sim, type) {
    switch(type) {
        case 'inf': return sim.step;
        case 'rup': return sim.step;
        case 'wh': return sim.step; // WH stage stored as step
        case 'ran': return sim.per;
        default: return sim.step;
    }
}

// Format the varying parameter for display (handles combined simulations)
function formatSimVaryingParam(sim) {
    if (!sim) return 'N/A';
    
    const type = sim.type || sim.headerData?.simType || 'inf';
    const paramName = getVaryingParamName(type);
    
    if (sim.isCombined && sim.param1 !== undefined && sim.param2 !== undefined) {
        // Combined simulation - show both values
        const v1 = typeof sim.param1 === 'number' ? sim.param1.toFixed(1) : sim.param1;
        const v2 = typeof sim.param2 === 'number' ? sim.param2.toFixed(1) : sim.param2;
        return `${paramName}_1=${v1}, ${paramName}_2=${v2}`;
    } else {
        // Single simulation
        const value = getVaryingParamValue(sim, type);
        return `${paramName}=${typeof value === 'number' ? value.toFixed(1) : value}`;
    }
}

// Get short display string for simulation (type + varying params)
function getSimShortDisplay(sim) {
    if (!sim) return 'N/A';
    
    const type = sim.type || sim.headerData?.simType || 'inf';
    
    if (sim.isCombined && sim.param1 !== undefined && sim.param2 !== undefined) {
        const paramName = getVaryingParamName(type);
        const v1 = typeof sim.param1 === 'number' ? sim.param1.toFixed(1) : sim.param1;
        const v2 = typeof sim.param2 === 'number' ? sim.param2.toFixed(1) : sim.param2;
        return `${type}[C] ${paramName}:${v1}+${v2}`;
    } else {
        const value = getVaryingParamValue(sim, type);
        return `${type} ${typeof value === 'number' ? value.toFixed(1) : value}`;
    }
}

// Get full hover text for simulation
function getSimHoverText(sim) {
    if (!sim) return '';
    
    const base = `ac=${sim.ac.toFixed(3)}, alpha=${sim.alpha.toFixed(3)}, Rb=${sim.rb.toFixed(3)}, Cm=${sim.cm.toExponential(2)}`;
    const type = sim.type || sim.headerData?.simType || 'inf';
    const paramName = getVaryingParamName(type);
    
    if (sim.isCombined && sim.param1 !== undefined && sim.param2 !== undefined) {
        return `${base}, ${paramName}_1=${sim.param1}, ${paramName}_2=${sim.param2} [combined]`;
    } else {
        const paramValue = getVaryingParamValue(sim, type);
        return `${base}, ${paramName}=${paramValue}`;
    }
}

function formatParamValue(value) {
    // Format number for filename: replace '.' with '_'
    if (typeof value === 'number') {
        if (Math.abs(value) < 0.001 && value !== 0) {
            return value.toExponential(2).replace('.', '_').replace('+', '').replace('-', 'm');
        }
        return value.toFixed(2).replace('.', '_');
    }
    return String(value).replace('.', '_');
}

function generateCombinedName(sim1, sim2, type) {
    const paramName = getVaryingParamName(type);
    const val1 = getVaryingParamValue(sim1, type);
    const val2 = getVaryingParamValue(sim2, type);
    
    // Base name with shared parameters
    const baseName = `Z_${type}_ac${formatParamValue(sim1.ac)}_n_${sim1.n || 25}_Alp${formatParamValue(sim1.alpha)}_Rb${formatParamValue(sim1.rb)}_Cm${sim1.cm.toExponential(2).replace('.', '_')}`;
    
    // Add both varying parameters
    const combinedSuffix = `_${paramName}1_${formatParamValue(val1)}_${paramName}2_${formatParamValue(val2)}`;
    
    return baseName + combinedSuffix;
}

// v8 entry point: fetch sims from API if needed, then run combination logic
function combineSimulations() {
    if (!serverLibrary.connected) {
        showStatus('Connect to simulation library first', 'error');
        return;
    }

    // Check if simulationData is already populated (cached from a previous fetch)
    const totalCached = simulationData.inf.length + simulationData.rup.length +
                        simulationData.wh.length + simulationData.ran.length +
                        (simulationData.cov?.length || 0) + (simulationData.fus?.length || 0);

    if (totalCached > 0) {
        // Already have data in memory — run directly
        _executeCombineLogic();
    } else {
        // Fetch from API first
        _fetchSimsAndCombine();
    }
}

// Async: fetch sim impedance from API, populate simulationData, then combine
async function _fetchSimsAndCombine() {
    const btn = document.getElementById('combineBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }

    try {
        // Collect enabled types from UI
        const enabledTypes = _getEnabledCombineTypes();
        if (enabledTypes.length === 0) {
            showStatus('Select at least one simulation type to combine', 'error');
            return;
        }

        showStatus('Fetching simulations from server…', 'info');

        // For each enabled type, fetch metadata then impedance
        for (const type of enabledTypes) {
            const resp = await apiFilterSimulations({ types: new Set([type]) });
            if (!resp || resp.count === 0) {
                debugLog(`Combination: no sims found for type=${type}`);
                continue;
            }

            // Hard cap: do not fetch more than 500 sims per type
            // (combination of 500 x 500 = 250k sims is already very heavy)
            const meta = resp.simulations.slice(0, 500);
            const ids  = meta.map(s => s.id);

            const impedanceMap = await apiGetImpedanceBatch(ids);

            // Convert to v7-compatible sim objects
            const sims = meta
                .map(m => {
                    const imp = impedanceMap.get(m.id);
                    if (!imp) return null;
                    return impedanceDataToSim(imp, m);
                })
                .filter(Boolean);

            // Store in the appropriate simulationData slot
            // v8 types: cov/fus/wh/ran; v7 legacy types: inf/rup
            const slot = _typeToSlot(type);
            if (!simulationData[slot]) simulationData[slot] = [];
            simulationData[slot] = simulationData[slot].concat(sims);

            debugLog(`Combination: fetched ${sims.length} sims for type=${type} -> slot=${slot}`);
        }

        // Run the actual combination
        _executeCombineLogic();

    } catch (err) {
        showStatus(`Failed to fetch simulations: ${err.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Generate Combinations'; }
    }
}

// Map new v8 type names to simulationData slots (preserving v7 key names)
function _typeToSlot(type) {
    switch (type) {
        case 'cov': return 'wh';   // confluent ≈ formerly wh
        case 'fus': return 'inf';  // infected/fused ≈ formerly inf
        case 'inf': return 'inf';
        case 'rup': return 'rup';
        case 'wh':  return 'wh';
        case 'ran': return 'ran';
        default:    return type;
    }
}

// Collect enabled type checkboxes from combination panel (v8 names + v7 legacy)
function _getEnabledCombineTypes() {
    const types = [];
    // v8 type checkboxes
    if (document.getElementById('combineType_cov')?.checked) types.push('cov');
    if (document.getElementById('combineType_fus')?.checked) types.push('fus');
    if (document.getElementById('combineType_wh')?.checked)  types.push('wh');
    if (document.getElementById('combineType_ran')?.checked) types.push('ran');
    // v7 legacy checkboxes (still present in HTML for compatibility)
    if (document.getElementById('combineType_inf')?.checked) types.push('inf');
    if (document.getElementById('combineType_rup')?.checked) types.push('rup');
    return types;
}

// Original combination logic (runs after simulationData is populated)
function _executeCombineLogic() {
    const totalSims = simulationData.inf.length + simulationData.rup.length +
                     simulationData.wh.length  + simulationData.ran.length +
                     (simulationData.cov?.length || 0) + (simulationData.fus?.length || 0);

    if (totalSims === 0) {
        showStatus('No simulations available to combine', 'error');
        return;
    }
    
    // Always create fresh backup before combining
    originalSimulationData = {
        inf: JSON.parse(JSON.stringify(simulationData.inf)),
        rup: JSON.parse(JSON.stringify(simulationData.rup)),
        wh: JSON.parse(JSON.stringify(simulationData.wh)),
        ran: JSON.parse(JSON.stringify(simulationData.ran))
    };
    debugLog(' Backed up original simulations');

    // Get range filters
    let ranges = null;
    if (typeof getRangeFilters === 'function') {
        ranges = getRangeFilters();
    }

    // Get enabled types using shared helper (supports both v7 and v8 type names)
    // Map v8 names to the slots used in simulationData / originalSimulationData
    const enabledRawTypes = _getEnabledCombineTypes();
    // Deduplicate by slot (e.g. cov->wh and wh->wh should not double-process)
    const enabledSlots = [...new Set(enabledRawTypes.map(_typeToSlot))];

    debugLog('=== Starting Simulation Combination ===');
    debugLog('Enabled slots:', enabledSlots);

    let totalCombinations = 0;
    let totalSkipped = 0;

    enabledSlots.forEach(type => {
        const slot = _typeToSlot(type);
        let sims = simulationData[slot] || [];
        if (sims.length === 0) return;

        // Apply range filters if available
        if (ranges && typeof simMatchesRangeFilters === 'function') {
            const beforeCount = sims.length;
            sims = sims.filter(s => simMatchesRangeFilters(s, ranges));
            debugLog(`  ${type}: ${beforeCount} -> ${sims.length} after range filter`);
        }
        
        if (sims.length === 0) {
            debugLog(`  ${type}: No simulations after filter`);
            return;
        }
        
        debugLog(`Processing ${type}: ${sims.length} simulations`);
        
        // Group by parameters
        const groups = {};
        sims.forEach(sim => {
            const key = getCombineGroupKey(sim);
            if (!groups[key]) groups[key] = [];
            groups[key].push(sim);
        });
        
        debugLog(`  ${Object.keys(groups).length} groups found`);
        
        // Cartesian product within each group
        const combined = [];
        Object.entries(groups).forEach(([groupKey, groupSims]) => {
            const n = groupSims.length;
            debugLog(`  Group ${groupKey}: ${n} sims -> ${n * (n + 1) / 2} combinations`);

            // Triangular with diagonal: includes self-combinations (i,i), no symmetric duplicates
            for (let i = 0; i < n; i++) {
                for (let j = i; j < n; j++) {
                    const sim1 = groupSims[i];
                    const sim2 = groupSims[j];
                    
                    const combinedSim = combineTwoSimulations(sim1, sim2, type);
                    if (combinedSim !== null) {
                        combined.push(combinedSim);
                    } else {
                        totalSkipped++;
                    }
                }
            }
        });
        
        // Replace simulation data with combined
        simulationData[type] = combined;
        totalCombinations += combined.length;
        
        debugLog(`  ${type}: ${sims.length} -> ${combined.length} simulations`);
    });
    
    if (totalSkipped > 0) {
        const warningEl = document.getElementById('loadedSimsWarning');
        if (warningEl) {
            warningEl.style.display = 'block';
            warningEl.innerHTML += `<br>⚠️ <b>${totalSkipped} combination pair(s) skipped</b> — frequency array length mismatch between sims (data artifact in older simulation files). Re-ingest DB to fix permanently.`;
        }
        console.warn(`Combination: ${totalSkipped} pairs skipped due to impedance length mismatch.`);
    }

    // Update unique params from combined simulations
    updateUniqueParamsFromCombined();
    
    // Update UI
    updateFilterOptions();
    updateDataSummary();
    
    document.getElementById('combineCountDisplay').innerHTML = 
        `Generated <strong>${totalCombinations}</strong> combined simulations`;
    document.getElementById('combineCountDisplay').parentElement.style.background = '#c8e6c9';
    
    showStatus(` Combined simulations: ${totalCombinations} total`, 'success');
    debugLog(`=== Combination Complete: ${totalCombinations} total ===`);
}

function combineTwoSimulations(sim1, sim2, type) {
    // Skip combinations where frequency arrays have different lengths
    if (sim1.impedance.length !== sim2.impedance.length) {
        debugLog(`combineTwoSimulations: skipping pair — impedance length mismatch (${sim1.impedance.length} vs ${sim2.impedance.length})`);
        return null;
    }

    const numFreqs = sim1.frequency.length;

    // Combine impedance: Z = Z1 + Z2 (complex addition)
    const combinedImpedance = sim1.impedance.map((z1, i) => {
        const z2 = sim2.impedance[i];
        return {
            real: z1.real + z2.real,
            imag: z1.imag + z2.imag
        };
    });
    
    // Each simulation file header has half the experimental R_constr (one per electrode).
    // The sum gives the full constriction resistance matching the physical measurement.
    // NOTE: rConstr is stored in headerData (from the API response), NOT at the top level.
    const sim1RConstr = sim1.headerData?.rConstr ?? sim1.rConstr ?? sim1.r_constr ?? 0;
    const sim2RConstr = sim2.headerData?.rConstr ?? sim2.rConstr ?? sim2.r_constr ?? 0;
    const combinedRConstr = sim1RConstr + sim2RConstr;
    
    // Combine cell statistics (addition)
    const hd1 = sim1.headerData || {};
    const hd2 = sim2.headerData || {};
    
    const combinedTotalCells = (hd1.totalCells || 729) + (hd2.totalCells || 729);
    const combinedAliveCells = (hd1.aliveCells || 0) + (hd2.aliveCells || 0);
    const combinedDeadCells = (hd1.deadCells || 0) + (hd2.deadCells || 0);
    const combinedFusedCells = (hd1.fusedCells || 0) + (hd2.fusedCells || 0);
    const combinedCellsOnElectrode = (hd1.cellsOnElectrode || 0) + (hd2.cellsOnElectrode || 0);
    const combinedElectrodeCells = (hd1.electrodeCells || 0) + (hd2.electrodeCells || 0);

    // Recalculate percentages
    const combinedCoverage = combinedTotalCells > 0 ? 
        (combinedCellsOnElectrode / combinedTotalCells) * 100 : 0;
    
    // Generate combined name
    const combinedFilename = generateCombinedName(sim1, sim2, type);
    
    // Create varying param values for the combined simulation
    const param1 = getVaryingParamValue(sim1, type);
    const param2 = getVaryingParamValue(sim2, type);
    
    // Create combined simulation object
    const combined = {
        type: type,
        ac: sim1.ac,
        n: sim1.n || 25,
        alpha: sim1.alpha,
        rb: sim1.rb,
        cm: sim1.cm,
        rConstr: combinedRConstr,
        frequency: [...sim1.frequency],
        impedance: combinedImpedance,
        filename: combinedFilename,
        isCombined: true,
        sourceFiles: [sim1.filename, sim2.filename],
        // Store both varying param values
        param1: param1,
        param2: param2,
        // Keep step for compatibility (use average or first)
        step: (param1 + param2) / 2,
        per: type === 'ran' ? (param1 + param2) / 2 : sim1.per,
        iter: (sim1.iter || 1) + (sim2.iter || 1),
        // Store individual electrode data for separate culture rendering
        electrode1: {
            headerData: JSON.parse(JSON.stringify(hd1)),
            step: sim1.step,
            per: sim1.per,
            type: sim1.type || type,
            ac: sim1.ac,
            alpha: sim1.alpha,
            rb: sim1.rb,
            cm: sim1.cm,
            rConstr: sim1RConstr
        },
        electrode2: {
            headerData: JSON.parse(JSON.stringify(hd2)),
            step: sim2.step,
            per: sim2.per,
            type: sim2.type || type,
            ac: sim2.ac,
            alpha: sim2.alpha,
            rb: sim2.rb,
            cm: sim2.cm,
            rConstr: sim2RConstr
        },
        headerData: {
            simType: type,
            totalCells: combinedTotalCells,
            aliveCells: combinedAliveCells,
            deadCells: combinedDeadCells,
            fusedCells: combinedFusedCells,
            cellsOnElectrode: combinedCellsOnElectrode,
            electrodeCells: combinedElectrodeCells,
            coverage: combinedCoverage,
            rConstr: combinedRConstr,
            // For wound healing
            whStage: type === 'wh' ? (param1 + param2) / 2 : 0
        }
    };
    
    return combined;
}

function updateUniqueParamsFromCombined() {
    // Clear and rebuild unique params
    uniqueParams.ac.clear();
    uniqueParams.alpha.clear();
    uniqueParams.rb.clear();
    uniqueParams.cm.clear();
    uniqueParams.step.clear();
    
    const allSims = [
        ...simulationData.inf,
        ...simulationData.rup,
        ...simulationData.wh,
        ...simulationData.ran
    ];
    
    allSims.forEach(sim => {
        uniqueParams.ac.add(round3(sim.ac));
        uniqueParams.alpha.add(round3(sim.alpha));
        uniqueParams.rb.add(round3(sim.rb));
        uniqueParams.cm.add(sim.cm);
        if (sim.step !== undefined) uniqueParams.step.add(sim.step);
    });
}

function resetSimulations() {
    if (originalSimulationData) {
        // Restore from backup (v7 path or after a prior combine+reset cycle)
        simulationData.inf = JSON.parse(JSON.stringify(originalSimulationData.inf));
        simulationData.rup = JSON.parse(JSON.stringify(originalSimulationData.rup));
        simulationData.wh  = JSON.parse(JSON.stringify(originalSimulationData.wh));
        simulationData.ran = JSON.parse(JSON.stringify(originalSimulationData.ran));
        originalSimulationData = null;
        debugLog(' Restored from backup and cleared backup');
    } else {
        // v8 path: just clear cached sims — they will be re-fetched next time
        simulationData.inf = [];
        simulationData.rup = [];
        simulationData.wh  = [];
        simulationData.ran = [];
        debugLog(' Cleared cached simulations (will re-fetch from API on next Combine)');
    }

    // Update unique params
    updateUniqueParamsFromCombined();

    // Update UI
    updateFilterOptions();
    updateDataSummary();

    document.getElementById('combineCountDisplay').textContent = 'Reset — sims cleared';
    document.getElementById('combineCountDisplay').parentElement.style.background = '#e3f2fd';

    showStatus('Simulations reset. Will re-fetch from server on next Combine.', 'success');
}

function updateFilterOptions() {
    const createCheckboxes = (container, values, prefix) => {
        if (!container) return;
        container.innerHTML = '';
        const sorted = [...values].sort((a, b) => a - b);
        debugLog(`Creating checkboxes for ${prefix}:`, sorted);
        sorted.forEach(val => {
            const label = document.createElement('label');
            const displayVal = val < 0.001 ? val.toExponential(2) : val.toFixed(3);
            label.innerHTML = `<input type="checkbox" checked value="${val}" class="filter-${prefix}"> ${displayVal}`;
            container.appendChild(label);
        });
    };
    
    createCheckboxes(document.getElementById('acFilters'), uniqueParams.ac, 'ac');
    createCheckboxes(document.getElementById('alphaFilters'), uniqueParams.alpha, 'alpha');
    createCheckboxes(document.getElementById('rbFilters'), uniqueParams.rb, 'rb');
    createCheckboxes(document.getElementById('cmFilters'), uniqueParams.cm, 'cm');
    
    // Collect step values by simulation type
    const stepByType = {
        inf: new Set(),  // inf and rup use step
        wh: new Set(),   // wound healing stage
        ran: new Set(),  // random death percentage
        combined: new Set()  // combined simulations (averaged)
    };
    
    // Collect from inf simulations
    simulationData.inf.forEach(sim => {
        if (sim.isCombined) {
            stepByType.combined.add(sim.step);
        } else {
            stepByType.inf.add(sim.step);
        }
    });
    
    // Collect from rup simulations (same as inf - uses step)
    simulationData.rup.forEach(sim => {
        if (sim.isCombined) {
            stepByType.combined.add(sim.step);
        } else {
            stepByType.inf.add(sim.step);
        }
    });
    
    // Collect from wh simulations
    simulationData.wh.forEach(sim => {
        if (sim.isCombined) {
            stepByType.combined.add(sim.step);
        } else {
            stepByType.wh.add(sim.step);
        }
    });
    
    // Collect from ran simulations
    simulationData.ran.forEach(sim => {
        if (sim.isCombined) {
            stepByType.combined.add(sim.step);
        } else {
            stepByType.ran.add(sim.step);
        }
    });
    
    // Create checkboxes for each type
    createCheckboxes(document.getElementById('stepInfFilters'), stepByType.inf, 'step-inf');
    createCheckboxes(document.getElementById('stepWhFilters'), stepByType.wh, 'step-wh');
    createCheckboxes(document.getElementById('stepRanFilters'), stepByType.ran, 'step-ran');
    createCheckboxes(document.getElementById('stepCombinedFilters'), stepByType.combined, 'step-combined');
    
    // Show/hide groups based on content
    const infGroup = document.getElementById('stepInfGroup');
    const whGroup = document.getElementById('stepWhGroup');
    const ranGroup = document.getElementById('stepRanGroup');
    const combinedGroup = document.getElementById('stepCombinedGroup');
    
    if (infGroup) infGroup.style.display = stepByType.inf.size > 0 ? 'block' : 'none';
    if (whGroup) whGroup.style.display = stepByType.wh.size > 0 ? 'block' : 'none';
    if (ranGroup) ranGroup.style.display = stepByType.ran.size > 0 ? 'block' : 'none';
    if (combinedGroup) combinedGroup.style.display = stepByType.combined.size > 0 ? 'block' : 'none';
    
    // Populate spectral analysis dropdowns
    populateSpectralFilterDropdowns();
}

function populateSpectralFilterDropdowns() {
    const createDropdown = (selectId, values, formatFn) => {
        const select = document.getElementById(selectId);
        if (!select) return;
        select.innerHTML = '';
        const sorted = [...values].sort((a, b) => a - b);
        sorted.forEach(val => {
            const option = document.createElement('option');
            option.value = val;
            option.textContent = formatFn ? formatFn(val) : val;
            select.appendChild(option);
        });
    };
    
    const formatScientific = v => v < 0.001 ? v.toExponential(2) : v.toFixed(3);
    
    createDropdown('spectralAlpha', uniqueParams.alpha, v => v.toFixed(3));
    createDropdown('spectralRb', uniqueParams.rb, v => v.toFixed(3));
    createDropdown('spectralCm', uniqueParams.cm, formatScientific);
    
    updateSimCount();
}

function updateSimCount() {
    const alphaSelect = document.getElementById('spectralAlpha');
    const rbSelect = document.getElementById('spectralRb');
    const cmSelect = document.getElementById('spectralCm');
    const countDisplay = document.getElementById('simMatchCount');
    
    if (!alphaSelect || !rbSelect || !cmSelect || !countDisplay) return;
    
    const selectedAlpha = parseFloat(alphaSelect.value);
    const selectedRb = parseFloat(rbSelect.value);
    const selectedCm = parseFloat(cmSelect.value);
    
    const allSims = getTypeFilteredSims();
    const matchingSims = allSims.filter(sim => 
        Math.abs(sim.alpha - selectedAlpha) < 1e-6 &&
        Math.abs(sim.rb - selectedRb) < 1e-6 &&
        Math.abs(sim.cm - selectedCm) < 1e-9
    );
    
    countDisplay.textContent = matchingSims.length;
}

function getTypeFilteredSims() {
    let sims = [];
    // v7 legacy type checkboxes
    if (document.getElementById('simTypeInf')?.checked) sims = sims.concat(simulationData.inf);
    if (document.getElementById('simTypeRup')?.checked) sims = sims.concat(simulationData.rup);
    if (document.getElementById('simTypeWh')?.checked)  sims = sims.concat(simulationData.wh);
    if (document.getElementById('simTypeRan')?.checked) sims = sims.concat(simulationData.ran);
    // v8 type checkboxes (map to same slots)
    if (document.getElementById('simTypeCov')?.checked) sims = sims.concat(simulationData.wh);  // cov -> wh slot
    if (document.getElementById('simTypeFus')?.checked) sims = sims.concat(simulationData.inf);  // fus -> inf slot
    return sims;
}

function getSpectralSimFilters() {
    const alphaSelect = document.getElementById('spectralAlpha');
    const rbSelect = document.getElementById('spectralRb');
    const cmSelect = document.getElementById('spectralCm');
    
    return {
        alpha: parseFloat(alphaSelect?.value) || 0,
        rb: parseFloat(rbSelect?.value) || 0,
        cm: parseFloat(cmSelect?.value) || 0
    };
}

function toggleSpectralSimFilters() {
    const checkbox = document.getElementById('showSimulations');
    const panel = document.getElementById('spectralSimFilters');
    if (panel) {
        panel.style.display = checkbox.checked ? 'block' : 'none';
    }
}

// Find original simulation by electrode parameters
function findOriginalSimulation(elecData) {
    if (!elecData || !originalSimulationData) return null;
    
    const type = elecData.type || 'inf';
    const originals = originalSimulationData[type] || [];
    
    return originals.find(s => 
        Math.abs(s.ac - elecData.ac) < 1e-6 &&
        Math.abs(s.alpha - elecData.alpha) < 1e-6 &&
        Math.abs(s.rb - elecData.rb) < 1e-6 &&
        Math.abs(s.cm - elecData.cm) < 1e-9 &&
        (s.step === elecData.step || s.per === elecData.per)
    );
}

// ============================================================