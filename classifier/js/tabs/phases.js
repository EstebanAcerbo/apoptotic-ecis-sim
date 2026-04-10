// ============================================================
// ECIS CLASSIFIER - EVOLUTION PHASES MODULE
// ============================================================
// Manages multi-phase classification where different time periods
// can have independent optimal parameter groups.
// 
// Key functions:
// - addPhase/removeLastPhase: Manage phase list
// - autoDistributePhases: Evenly distribute spectra across phases
// - getPhaseDefinitions: Return phase config for classification
// - simMatchesFilters: Check if simulation passes filter criteria
// ============================================================

let evolutionPhases = []; // Array of {endIndex, endTimeH, name}
let _stageInputMode  = 'index'; // 'index' | 'time'

/** Switch between spectrum-index and time-based stage boundaries. */
function setStageInputMode(mode) {
    _stageInputMode = mode;
    renderPhasesList();
    updatePhaseSummary();
}

function togglePhasesPanel() {
    const checkbox = document.getElementById('enablePhases');
    const container = document.getElementById('phasesContainer');
    container.style.display = checkbox.checked ? 'block' : 'none';

    if (checkbox.checked && evolutionPhases.length === 0) {
        // Initialize with 2 stages by default
        addPhase();
        addPhase();
    }
    updatePhaseSummary();
}

/** Return {maxSpectra, maxTimeH} for the first loaded channel. */
function _channelStats() {
    const channels = experimentalData.channels;
    if (channels.length === 0) return { maxSpectra: 10, maxTimeH: 10 };
    const firstCh = channels[0];
    const chData  = experimentalData.processed.filter(d => d.channelName === firstCh);
    const maxTimeH = chData.length ? Math.max(...chData.map(d => d.timeHours)) : 10;
    return { maxSpectra: chData.length || 10, maxTimeH: maxTimeH || 10 };
}

function updateTotalSpectraInfo() {
    const info = document.getElementById('totalSpectraInfo');
    if (!info) return;

    const channels = experimentalData.channels;
    if (channels.length === 0) { info.textContent = '(Load data first)'; return; }

    const { maxSpectra, maxTimeH } = _channelStats();
    if (_stageInputMode === 'time') {
        info.textContent = `Duration: 0 h – ${maxTimeH.toFixed(2)} h (${maxSpectra} spectra)`;
    } else {
        info.textContent = `Total spectra per channel: ${maxSpectra} (indices 0–${maxSpectra - 1})`;
    }
}

function addPhase() {
    const { maxSpectra, maxTimeH } = _channelStats();
    const numPhases  = evolutionPhases.length + 1;

    const defaultEndIdx  = Math.min(
        evolutionPhases.length === 0
            ? Math.floor(maxSpectra / 3)
            : Math.round((numPhases / (numPhases + 1)) * maxSpectra) - 1,
        maxSpectra - 1
    );
    const defaultEndTime = parseFloat((
        evolutionPhases.length === 0
            ? maxTimeH / 3
            : (numPhases / (numPhases + 1)) * maxTimeH
    ).toFixed(2));

    evolutionPhases.push({
        endIndex: defaultEndIdx,
        endTimeH: defaultEndTime,
        name: `Stage ${evolutionPhases.length + 1}`,
    });

    renderPhasesList();
    updatePhaseSummary();
}

function removeLastPhase() {
    if (evolutionPhases.length > 1) {
        evolutionPhases.pop();
        renderPhasesList();
        updatePhaseSummary();
    }
}

function autoDistributePhases() {
    const { maxSpectra, maxTimeH } = _channelStats();
    const numPhases = evolutionPhases.length;
    if (numPhases === 0 || maxSpectra === 0) return;

    evolutionPhases.forEach((phase, idx) => {
        if (idx < numPhases - 1) {
            phase.endIndex = Math.round(((idx + 1) / numPhases) * maxSpectra) - 1;
            phase.endTimeH = parseFloat((((idx + 1) / numPhases) * maxTimeH).toFixed(2));
        } else {
            phase.endIndex = maxSpectra - 1;
            phase.endTimeH = parseFloat(maxTimeH.toFixed(2));
        }
    });

    renderPhasesList();
    updatePhaseSummary();
}

function renderPhasesList() {
    const container = document.getElementById('phasesList');
    if (!container) return;

    const { maxSpectra, maxTimeH } = _channelStats();

    container.innerHTML = evolutionPhases.map((phase, idx) => {
        const isLast = idx === evolutionPhases.length - 1;
        const color  = `hsl(${idx * 60}, 70%, 50%)`;

        if (_stageInputMode === 'time') {
            const startT = idx === 0 ? 0 : evolutionPhases[idx - 1].endTimeH;
            const endT   = phase.endTimeH ?? 0;
            return `
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; padding:8px; background:white; border-radius:5px; border-left:4px solid ${color};">
                    <span style="font-weight:600; min-width:70px;">Stage ${idx + 1}:</span>
                    <span style="color:#666; font-size:12px;">${startT.toFixed(2)} h to</span>
                    <input type="number"
                           value="${endT.toFixed(2)}"
                           min="${(startT + 0.01).toFixed(2)}"
                           max="${maxTimeH.toFixed(2)}"
                           step="0.01"
                           onchange="updatePhaseEndTime(${idx}, this.value)"
                           style="width:72px; padding:4px; border:1px solid #ddd; border-radius:3px;">
                    <span style="color:#666; font-size:12px;">h &nbsp;(${(endT - startT).toFixed(2)} h)</span>
                    ${isLast ? '<span style="color:#28a745; font-size:11px; margin-left:auto;">→ END</span>' : ''}
                </div>`;
        } else {
            const startIdx = idx === 0 ? 0 : evolutionPhases[idx - 1].endIndex + 1;
            return `
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; padding:8px; background:white; border-radius:5px; border-left:4px solid ${color};">
                    <span style="font-weight:600; min-width:70px;">Stage ${idx + 1}:</span>
                    <span style="color:#666; font-size:12px;">Spectra ${startIdx} to</span>
                    <input type="number"
                           value="${phase.endIndex}"
                           min="${startIdx}"
                           max="${maxSpectra - 1}"
                           onchange="updatePhaseEnd(${idx}, this.value)"
                           style="width:60px; padding:4px; border:1px solid #ddd; border-radius:3px;">
                    <span style="color:#666; font-size:12px;">(${phase.endIndex - startIdx + 1} spectra)</span>
                    ${isLast ? '<span style="color:#28a745; font-size:11px; margin-left:auto;">→ END</span>' : ''}
                </div>`;
        }
    }).join('');
}

function updatePhaseEnd(phaseIdx, value) {
    const newEnd = parseInt(value);
    if (isNaN(newEnd)) return;
    evolutionPhases[phaseIdx].endIndex = newEnd;
    // Cascade: ensure subsequent phases stay valid
    for (let i = phaseIdx + 1; i < evolutionPhases.length; i++) {
        const minStart = evolutionPhases[i - 1].endIndex + 1;
        if (evolutionPhases[i].endIndex <= minStart) evolutionPhases[i].endIndex = minStart + 1;
    }
    renderPhasesList();
    updatePhaseSummary();
}

function updatePhaseEndTime(phaseIdx, value) {
    const newEnd = parseFloat(value);
    if (isNaN(newEnd)) return;
    evolutionPhases[phaseIdx].endTimeH = newEnd;
    // Cascade: ensure subsequent phases stay valid
    for (let i = phaseIdx + 1; i < evolutionPhases.length; i++) {
        const minStart = evolutionPhases[i - 1].endTimeH;
        if (evolutionPhases[i].endTimeH <= minStart)
            evolutionPhases[i].endTimeH = parseFloat((minStart + 0.1).toFixed(2));
    }
    renderPhasesList();
    updatePhaseSummary();
}

function updatePhaseSummary() {
    const summary = document.getElementById('phaseSummary');
    if (!summary) return;

    updateTotalSpectraInfo();

    if (evolutionPhases.length === 0) {
        summary.innerHTML = '<em>No stages defined</em>';
        return;
    }

    const { maxSpectra, maxTimeH } = _channelStats();
    let html = '<strong>Summary:</strong><br>';

    if (_stageInputMode === 'time') {
        evolutionPhases.forEach((phase, idx) => {
            const startT = idx === 0 ? 0 : evolutionPhases[idx - 1].endTimeH;
            const endT   = phase.endTimeH;
            html += `<span style="color:hsl(${idx * 60},70%,40%);">[${idx + 1}]</span> Stage ${idx + 1}: ${startT.toFixed(2)} h – ${endT.toFixed(2)} h (${(endT - startT).toFixed(2)} h)<br>`;
        });
        const lastEnd = evolutionPhases[evolutionPhases.length - 1].endTimeH;
        if (lastEnd < maxTimeH - 0.01) {
            html += `<span style="color:#dc3545;">⚠ Period ${lastEnd.toFixed(2)} h – ${maxTimeH.toFixed(2)} h not covered!</span>`;
        } else {
            html += `<span style="color:#28a745;">✓ Full duration covered</span>`;
        }
    } else {
        evolutionPhases.forEach((phase, idx) => {
            const startIdx = idx === 0 ? 0 : evolutionPhases[idx - 1].endIndex + 1;
            const count    = phase.endIndex - startIdx + 1;
            html += `<span style="color:hsl(${idx * 60},70%,40%);">[${idx + 1}]</span> Stage ${idx + 1}: spectra ${startIdx}–${phase.endIndex} (${count} spectra)<br>`;
        });
        const lastEnd = evolutionPhases[evolutionPhases.length - 1].endIndex;
        if (lastEnd < maxSpectra - 1) {
            html += `<span style="color:#dc3545;">⚠ Spectra ${lastEnd + 1}–${maxSpectra - 1} not covered!</span>`;
        } else if (lastEnd >= maxSpectra) {
            html += `<span style="color:#dc3545;">⚠ End index exceeds available spectra (max: ${maxSpectra - 1})</span>`;
        } else {
            html += `<span style="color:#28a745;">✓ All ${maxSpectra} spectra covered</span>`;
        }
    }

    summary.innerHTML = html;
}

function getPhaseDefinitions() {
    if (!document.getElementById('enablePhases')?.checked || evolutionPhases.length === 0) {
        return null;
    }

    if (_stageInputMode === 'time') {
        return evolutionPhases.map((phase, idx) => ({
            phaseIndex: idx,
            phaseName:  `Stage ${idx + 1}`,
            startTimeH: idx === 0 ? 0 : evolutionPhases[idx - 1].endTimeH,
            endTimeH:   phase.endTimeH,
            byTime:     true,
        }));
    }

    return evolutionPhases.map((phase, idx) => ({
        phaseIndex: idx,
        phaseName:  `Stage ${idx + 1}`,
        startIndex: idx === 0 ? 0 : evolutionPhases[idx - 1].endIndex + 1,
        endIndex:   phase.endIndex,
    }));
}

function selectAllFilters() {
    document.querySelectorAll('[class^="filter-"]').forEach(cb => cb.checked = true);
}

function deselectAllFilters() {
    document.querySelectorAll('[class^="filter-"]').forEach(cb => cb.checked = false);
}

// getSelectedFilters() is defined in dataLoading.js — do not duplicate here

// Helper to compare floats with tolerance (avoids precision issues)
function floatInArray(value, array, tolerance = 1e-6) {
    return array.some(v => Math.abs(v - value) < tolerance || Math.abs(v - value) / Math.abs(v) < tolerance);
}

function simMatchesFilters(sim, filters) {
    // Check simulation type filter first
    const simType = sim.type || sim.headerData?.simType || 'inf';
    if (!filters.types[simType]) {
        return false;
    }
    
    // Check base parameters
    const baseMatch = floatInArray(sim.ac, filters.acs) &&
           floatInArray(sim.alpha, filters.alphas) &&
           floatInArray(sim.rb, filters.rbs) &&
           floatInArray(sim.cm, filters.cms);
    
    if (!baseMatch) return false;
    
    // For combined simulations, check combined step filters
    if (sim.isCombined) {
        return floatInArray(sim.step, filters.stepsCombined);
    }
    
    // Check step filter based on simulation type
    switch (simType) {
        case 'inf':
        case 'rup':
            return floatInArray(sim.step, filters.stepsInf);
        case 'wh':
            return floatInArray(sim.step, filters.stepsWh);
        case 'ran':
            return floatInArray(sim.step, filters.stepsRan);
        default:
            return floatInArray(sim.step, filters.stepsInf);
    }
}

// ============================================================
