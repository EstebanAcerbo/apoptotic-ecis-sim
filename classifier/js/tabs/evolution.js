// ============================================================
// ECIS CLASSIFIER - EVOLUTION ANALYSIS MODULE
// ============================================================
// Generates time-evolution plots for selected channels.
// Plots |Z|, Phase, R, and C at user-selected frequencies.
// Integrates with microscopy module to show image markers.
// ============================================================
function updateEvolutionPlots() {
    if (experimentalData.processed.length === 0) return;
    if (selectedChannels.evolution.size === 0) return;
    
    const freqZIdx = parseInt(document.getElementById('freqZ').value);
    const freqPhaseIdx = parseInt(document.getElementById('freqPhase').value);
    const freqRIdx = parseInt(document.getElementById('freqR').value);
    const freqCIdx = parseInt(document.getElementById('freqC').value);
    
    const freqZ = experimentalData.frequencies[freqZIdx];
    const freqPhase = experimentalData.frequencies[freqPhaseIdx];
    const freqR = experimentalData.frequencies[freqRIdx];
    const freqC = experimentalData.frequencies[freqCIdx];
    
    const channels = [...selectedChannels.evolution];
    // Use getChannelColor() so colors always match the user's color picker setting,
    // regardless of how many channels are selected. generateColors(n) re-indexes by
    // subset position and produces wrong colors when a channel subset is selected.
    const colors = channels.map(ch => getChannelColor(ch));
    
    const tracesZ = [], tracesPhase = [], tracesR = [], tracesC = [];
    
    channels.forEach((chName, idx) => {
        const chData = experimentalData.processed.filter(d => d.channelName === chName)
            .sort((a, b) => a.time - b.time);
        
        if (chData.length === 0) return;
        
        const times = chData.map(d => d.timeHours);
        
        // |Z| at selected frequency
        const zValues = chData.map(d => {
            const fIdx = d.frequency.findIndex(f => Math.abs(f - freqZ) < 1);
            return fIdx >= 0 ? d.magnitude[fIdx] : null;
        });
        
        // Phase at selected frequency
        const phaseValues = chData.map(d => {
            const fIdx = d.frequency.findIndex(f => Math.abs(f - freqPhase) < 1);
            return fIdx >= 0 ? d.phase[fIdx] : null;
        });
        
        // Calculate R and C from Z and phase
        const rValues = chData.map(d => {
            const fIdx = d.frequency.findIndex(f => Math.abs(f - freqR) < 1);
            if (fIdx < 0) return null;
            const z = d.magnitude[fIdx];
            const ph = d.phase[fIdx] * Math.PI / 180;
            return z * Math.cos(ph);
        });
        
        const cValues = chData.map(d => {
            const fIdx = d.frequency.findIndex(f => Math.abs(f - freqC) < 1);
            if (fIdx < 0) return null;
            const z = d.magnitude[fIdx];
            const ph = d.phase[fIdx] * Math.PI / 180;
            const f = d.frequency[fIdx];
            const zimag = -z * Math.sin(ph);
            return zimag > 0 ? 1 / (2 * Math.PI * f * zimag) : null;
        });
        
        const _dash = getChannelDash(chName);
        const baseTrace = {
            mode: _dash === 'none' ? 'markers' : 'lines+markers',
            name: chName,
            ...(_dash !== 'none' ? { line: { color: colors[idx], width: 2, dash: _dash } } : {}),
            marker: { color: colors[idx], size: getMarkerSize(), symbol: getChannelMarker(chName) }
        };
        
        tracesZ.push({ ...baseTrace, x: times, y: zValues });
        tracesPhase.push({ ...baseTrace, x: times, y: phaseValues });
        tracesR.push({ ...baseTrace, x: times, y: rValues });
        tracesC.push({ ...baseTrace, x: times, y: cValues });
    });
    
    const layout = {
        margin: { l: 60, r: 20, t: 40, b: 50 },
        hovermode: 'closest',
        showlegend: true,
        autosize: true
    };
    
    const plotConfig = { 
        responsive: true,
        toImageButtonOptions: {
            format: 'png',
            scale: 3,  // 3x resolution (~216 DPI)
            filename: 'evolution_plot'
        }
    };
    
    Plotly.newPlot('plotEvoZ', tracesZ, {
        ...layout,
        title: `|Z| Evolution @ ${formatFreq(freqZ)}`,
        xaxis: { title: 'Time [h]' },
        yaxis: { title: '|Z| [Ω]', type: 'log' }
    }, plotConfig);
    
    Plotly.newPlot('plotEvoPhase', tracesPhase, {
        ...layout,
        title: `Phase Evolution @ ${formatFreq(freqPhase)}`,
        xaxis: { title: 'Time [h]' },
        yaxis: { title: 'Phase [°]' }
    }, plotConfig);
    
    Plotly.newPlot('plotEvoR', tracesR, {
        ...layout,
        title: `Resistance Evolution @ ${formatFreq(freqR)}`,
        xaxis: { title: 'Time [h]' },
        yaxis: { title: 'R [Ω]', type: 'log' }
    }, plotConfig);
    
    Plotly.newPlot('plotEvoC', tracesC, {
        ...layout,
        title: `Capacitance Evolution @ ${formatFreq(freqC)}`,
        xaxis: { title: 'Time [h]' },
        yaxis: { title: 'C [F]', type: 'log' }
    }, plotConfig);
    
}

// ============================================================
// CELL POPULATION EVOLUTION PLOT (apoptosis simulations)
// ============================================================

// Colour palette for stage series — indexed by stage position (up to 8 stages)
const _stagePalette = ['#3498db', '#9b59b6', '#f39c12', '#e67e22', '#1abc9c', '#e74c3c', '#2c3e50', '#8e44ad'];

function _capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * Build (or rebuild) the stage toggle buttons inside #cellPopStageButtons.
 * Skips rebuild when the stage list has not changed.
 */
function _buildCellPopButtons(stageLabels) {
    const container = document.getElementById('cellPopStageButtons');
    if (!container) return;
    const tag = stageLabels.join('|');
    if (container.dataset.built === tag) return;
    container.dataset.built = tag;
    container.innerHTML = stageLabels.map(lbl =>
        `<button class="button" onclick="toggleCellPop('${lbl}')" id="btn-pop-${lbl}">${_capFirst(lbl)} stage</button>`
    ).join('');
}

/**
 * Toggle a cell-population series on/off, update button style, and replot.
 * @param {string} key  'alive' | 'dead' | 'allApo' | any stage label ('1st', '2nd', ...)
 */
function toggleCellPop(key) {
    if (!window._cellPopToggles) window._cellPopToggles = {};
    window._cellPopToggles[key] = !(window._cellPopToggles[key] ?? true);
    const btn = document.getElementById(`btn-pop-${key}`);
    if (btn) {
        btn.style.opacity    = window._cellPopToggles[key] ? '1'   : '0.4';
        btn.style.fontWeight = window._cellPopToggles[key] ? '600' : '400';
    }
    updateCellPopulationPlot();
}

/**
 * Build and render the Cell Population Evolution plot from simulationData.apo.
 * Stage labels and count are read dynamically from headerData.apoStages, so the
 * plot adapts to any number of stages without code changes.
 */
function updateCellPopulationPlot() {
    const section = document.getElementById('cellPopSection');
    if (!section) return;

    const apoSims = simulationData?.apo;
    if (!apoSims || apoSims.length === 0) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';

    // Determine stage labels from the first sim that carries apoStages data
    const _firstWithStages = apoSims.find(s => s.headerData?.apoStages?.length > 0);
    const stageLabels = _firstWithStages
        ? _firstWithStages.headerData.apoStages.map(s => s.label)
        : ['1st', '2nd', '3rd', '4th'];   // fallback for files missing the new header

    // Build / refresh the stage toggle buttons
    _buildCellPopButtons(stageLabels);

    // Initialise toggle state for every key (defaults to visible)
    if (!window._cellPopToggles) window._cellPopToggles = {};
    const tog = window._cellPopToggles;
    ['alive', 'dead', 'allApo', ...stageLabels].forEach(k => {
        if (tog[k] === undefined) tog[k] = true;
    });

    // Group sims by run key (everything except step)
    const groups = {};
    apoSims.forEach(sim => {
        const key = `${sim.ac}|${sim.n}|${sim.alpha}|${sim.rb}|${sim.cm}|${sim.per}|${sim.iter}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(sim);
    });

    // Sort each group by step
    Object.values(groups).forEach(g => g.sort((a, b) => a.step - b.step));

    const traces = [];
    const groupKeys = Object.keys(groups);

    groupKeys.forEach((runKey, gIdx) => {
        const sims     = groups[runKey];
        const steps    = sims.map(s => s.step);
        const alive    = sims.map(s => s.headerData?.aliveCells ?? 0);
        const dead     = sims.map(s => s.headerData?.deadCells  ?? 0);
        const allApo   = sims.map(s => s.headerData?.apoTotal   ?? 0);

        const runLabel = groupKeys.length > 1
            ? ` — Run ${gIdx + 1} (ac=${sims[0].ac}, α=${sims[0].alpha}, Rb=${sims[0].rb}, iter=${sims[0].iter})`
            : '';

        const seriesDefs = [
            { key: 'alive',  y: alive,  name: `Alive${runLabel}`,         dash: 'solid', color: '#2ecc71' },
            { key: 'dead',   y: dead,   name: `Dead${runLabel}`,          dash: 'solid', color: '#e74c3c' },
            ...stageLabels.map((lbl, i) => ({
                key:   lbl,
                y:     sims.map(s => s.headerData?.apoStages?.[i]?.count ?? 0),
                name:  `${_capFirst(lbl)} stage${runLabel}`,
                dash:  'dot',
                color: _stagePalette[i % _stagePalette.length],
            })),
            { key: 'allApo', y: allApo, name: `All Apoptosis${runLabel}`, dash: 'dash',  color: '#c0392b' },
        ];

        seriesDefs.forEach(({ key, y, name, dash, color }) => {
            if (!tog[key]) return;
            traces.push({
                x:      steps,
                y:      y,
                mode:   'lines+markers',
                name:   name,
                line:   { color, width: 2, dash },
                marker: { color, size: 5 },
            });
        });
    });

    Plotly.newPlot('plotCellPop', traces, {
        margin:     { l: 60, r: 20, t: 40, b: 50 },
        hovermode:  'closest',
        showlegend: true,
        autosize:   true,
        title:      'Cell Population vs Apoptosis Step',
        xaxis:      { title: 'Apoptosis Step' },
        yaxis:      { title: 'Cell Count' },
    }, {
        responsive: true,
        toImageButtonOptions: { format: 'png', scale: 3, filename: 'cell_population_plot' },
    });
}

// ============================================================
