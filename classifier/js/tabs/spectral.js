// ============================================================
// ECIS CLASSIFIER - SPECTRAL ANALYSIS MODULE
// ============================================================
// Generates frequency-domain plots (Bode plots) for impedance data.
// Supports overlay of experimental data with simulations.
// Uses index-based spectrum selection (not time-based).
//
// v8 changes:
// - Simulation overlay fetched from API (serverLibrary) instead of
//   simulationData arrays (which are always empty in v8).
// - updateSpectralPlots() renders experimental + best-fit traces
//   synchronously, then fetches sim overlay async if requested.
// ============================================================

// ------------------------------------------------------------
// Color helpers for temporal coloring in "show all times" mode
// ------------------------------------------------------------

/**
 * Extract the hue (0-360) from a generateColors() HSL string.
 * e.g. "hsl(120, 70%, 50%)" → 120
 */
function _hslHue(hslStr) {
    const m = hslStr.match(/hsl\((\d+)/);
    return m ? parseInt(m[1]) : 0;
}

/**
 * Build a color for a specific spectrum within a channel's time series.
 * When showAllTimes is false (single timepoint) → returns the base channel color.
 * When showAllTimes is true → interpolates lightness: early=light (80%), late=dark (30%).
 *
 * @param {string} baseColor   HSL string from generateColors()
 * @param {number} timeIdx     index of this spectrum (0 = first/oldest)
 * @param {number} totalTimes  total number of spectra for this channel
 * @param {boolean} showAllTimes
 * @returns {string} CSS color string
 */
function _spectralTimeColor(baseColor, timeIdx, totalTimes, showAllTimes) {
    if (!showAllTimes || totalTimes <= 1) return baseColor;
    const hue = _hslHue(baseColor);
    // Lightness: oldest (idx=0) → 80% (pale), newest (idx=N-1) → 30% (dark)
    const t = timeIdx / (totalTimes - 1);   // 0..1
    const L = Math.round(80 - t * 50);      // 80 → 30
    const S = Math.round(40 + t * 50);      // 40% → 90% saturation
    return `hsl(${hue}, ${S}%, ${L}%)`;
}

// ------------------------------------------------------------
// Internal: build experimental + best-fit traces (sync)
// ------------------------------------------------------------
function _buildSpectralExpTraces(selectedChs, spectrumIndex, showAllTimes, rConstrForExp, showBestFit) {
    const tracesZ = [], tracesPhase = [], tracesR = [], tracesC = [];
    // Build color map using getChannelColor() so each channel always gets its
    // user-set color, regardless of how many channels are currently selected.
    // generateColors(n) would re-index by subset position → wrong colors on partial selection.
    const channelColorMap = {};
    selectedChs.forEach(ch => { channelColorMap[ch] = getChannelColor(ch); });

    selectedChs.forEach(chName => {
        const allChSpectra = experimentalData.processed
            .filter(d => d.channelName === chName)
            .sort((a, b) => a.time - b.time);

        let chSpectra;
        if (showAllTimes) {
            chSpectra = allChSpectra;
        } else {
            if (spectrumIndex < allChSpectra.length) {
                chSpectra = [allChSpectra[spectrumIndex]];
            } else {
                // This channel has fewer spectra than the slider position — show its last one
                chSpectra = allChSpectra.length > 0 ? [allChSpectra[allChSpectra.length - 1]] : [];
            }
        }

        debugLog(`Channel ${chName}: ${chSpectra.length} spectra at index ${spectrumIndex} (total: ${allChSpectra.length})`);

        const baseColor = channelColorMap[chName];
        const totalTimes = allChSpectra.length;

        chSpectra.forEach((spectrum, specIdx) => {
            const label = `${spectrum.channelName} @ ${spectrum.timeHours.toFixed(3)}h`;
            // When showing multiple timepoints: color encodes time (pale=early, dark=late)
            // When showing single timepoint: use flat channel color
            const globalIdx = allChSpectra.indexOf(spectrum);
            const color = _spectralTimeColor(baseColor, globalIdx >= 0 ? globalIdx : specIdx, totalTimes, showAllTimes);

            debugLog(`  Adding trace: ${label}, color: ${color}`);

            // Reconstruct complex impedance, add R_constr overwrite to experimental display only
            const zData = spectrum.frequency.map((f, i) => {
                const mag = spectrum.magnitude[i];
                const phRad = spectrum.phase[i] * Math.PI / 180;
                const zRealOrig = mag * Math.cos(phRad);
                const zImag = mag * Math.sin(phRad);
                const zRealNew = zRealOrig + rConstrForExp;
                const magNew = Math.sqrt(zRealNew * zRealNew + zImag * zImag);
                const phaseNew = Math.atan2(zImag, zRealNew) * 180 / Math.PI;
                const capac = zImag < 0 ? -1 / (2 * Math.PI * f * zImag) : null;
                return { zMag: magNew, phase: phaseNew, R: zRealNew, C: capac };
            });

            const _dash = getChannelDash(chName);
            const baseTrace = {
                mode: _dash === 'none' ? 'markers' : 'lines+markers',
                name: label,
                ...(_dash !== 'none' ? { line: { color, width: 2, dash: _dash } } : {}),
                marker: { color, size: getMarkerSize(), symbol: getChannelMarker(chName) }
            };

            tracesZ.push({ ...baseTrace, x: spectrum.frequency, y: zData.map(d => d.zMag) });
            tracesPhase.push({ ...baseTrace, x: spectrum.frequency, y: zData.map(d => d.phase) });
            tracesR.push({ ...baseTrace, x: spectrum.frequency, y: zData.map(d => d.R) });
            tracesC.push({ ...baseTrace, x: spectrum.frequency, y: zData.map(d => d.C) });

            // Best-fit overlay from classification results
            if (showBestFit && classificationResults.length > 0) {
                const result = classificationResults.find(r =>
                    r.channel === spectrum.channelName && Math.abs(r.time - spectrum.time) < 1
                );

                if (result && result.bestSim) {
                    const sim = result.bestSim;
                    const simRConstr = getRConstr(sim);

                    const simMag = sim.impedance.map(z =>
                        Math.sqrt((z.real + simRConstr)**2 + z.imag**2)
                    );
                    const simPhase = sim.impedance.map(z =>
                        Math.atan2(z.imag, z.real + simRConstr) * 180 / Math.PI
                    );
                    const simR = sim.impedance.map(z => z.real + simRConstr);
                    const simC = sim.impedance.map((z, i) =>
                        z.imag < 0 ? -1/(2*Math.PI*sim.frequency[i]*z.imag) : null
                    );

                    const fitLabel = `fit ${spectrum.channelName} ${spectrum.timeHours.toFixed(3)}h`;
                    const hoverText = getSimHoverText(sim);

                    const fitTrace = {
                        mode: 'lines',
                        name: fitLabel,
                        line: { color: color, width: 2, dash: 'dash' },
                        hovertemplate: `%{y:.3e}<br>${hoverText}<extra></extra>`
                    };

                    tracesZ.push({ ...fitTrace, x: sim.frequency, y: simMag });
                    tracesPhase.push({ ...fitTrace, x: sim.frequency, y: simPhase });
                    tracesR.push({ ...fitTrace, x: sim.frequency, y: simR });
                    tracesC.push({ ...fitTrace, x: sim.frequency, y: simC });
                }
            }
        });
    });

    return { tracesZ, tracesPhase, tracesR, tracesC, channelColorMap };
}

// ------------------------------------------------------------
// Internal: append sim overlay traces from v7-compatible sim objects
// (called after converting from API responses via resultItemToSim / impedanceDataToSim)
// ------------------------------------------------------------
function _appendSimOverlayTracesV2(tracesZ, tracesPhase, tracesR, tracesC, sims) {
    if (!sims || sims.length === 0) return;

    const maxStep = Math.max(...sims.map(s => s.step || 0));

    sims.forEach(sim => {
        const stepForColor = sim.step || 0;
        const hue = maxStep > 0 ? (stepForColor / maxStep) * 240 : 0;
        const color = `hsla(${240 - hue}, 70%, 50%, 0.5)`;

        const simRConstr = getRConstr(sim);
        const simMag   = sim.impedance.map(z => Math.sqrt((z.real + simRConstr)**2 + z.imag**2));
        const simPhase = sim.impedance.map(z => Math.atan2(z.imag, z.real + simRConstr) * 180 / Math.PI);
        const simR     = sim.impedance.map(z => z.real + simRConstr);
        const simC     = sim.impedance.map((z, i) => z.imag < 0 ? -1/(2*Math.PI*sim.frequency[i]*z.imag) : null);

        const hoverText = getSimHoverText(sim);
        const traceName = sim.isCombined
            ? `Comb:${sim.param1?.toFixed(1)}+${sim.param2?.toFixed(1)}`
            : `s${sim.step}`;

        const simTrace = {
            mode: 'lines',
            name: traceName,
            line: { color, width: 1.5 },
            showlegend: true,
            hovertemplate: `%{y:.3e}<br>${hoverText}<extra></extra>`
        };

        tracesZ.push({ ...simTrace, x: sim.frequency, y: simMag });
        tracesPhase.push({ ...simTrace, x: sim.frequency, y: simPhase });
        tracesR.push({ ...simTrace, x: sim.frequency, y: simR });
        tracesC.push({ ...simTrace, x: sim.frequency, y: simC });
    });
}

// ------------------------------------------------------------
// Internal: render all four Plotly panels (sync)
// ------------------------------------------------------------
function _renderSpectralPlots(tracesZ, tracesPhase, tracesR, tracesC, channelLabel, titleSuffix) {
    const layout = {
        margin: { l: 60, r: 20, t: 40, b: 50 },
        hovermode: 'closest',
        xaxis: { title: 'Frequency [Hz]', type: 'log' },
        showlegend: true,
        autosize: true
    };

    const plotConfig = {
        responsive: true,
        toImageButtonOptions: { format: 'png', scale: 3, filename: 'spectral_plot' }
    };

    Plotly.newPlot('plotSpecZ',     tracesZ,     { ...layout, title: `|Z| vs Frequency - ${channelLabel}${titleSuffix}`,       yaxis: { title: '|Z| [Ω]', type: 'log' } }, plotConfig);
    Plotly.newPlot('plotSpecPhase', tracesPhase, { ...layout, title: `Phase vs Frequency - ${channelLabel}${titleSuffix}`,     yaxis: { title: 'Phase [°]' }             }, plotConfig);
    Plotly.newPlot('plotSpecR',     tracesR,     { ...layout, title: `Resistance vs Frequency - ${channelLabel}${titleSuffix}`, yaxis: { title: 'R [Ω]', type: 'log' }   }, plotConfig);
    Plotly.newPlot('plotSpecC',     tracesC,     { ...layout, title: `Capacitance vs Frequency - ${channelLabel}${titleSuffix}`, yaxis: { title: 'C [F]', type: 'log' }  }, plotConfig);
}

// ------------------------------------------------------------
// Public entry point (called by uiSetup, tab switch, slider)
// ------------------------------------------------------------
function updateSpectralPlots() {
    if (experimentalData.processed.length === 0) return;
    if (selectedChannels.spectral.size === 0) return;

    const showAllTimes = document.getElementById('showAllTimes').checked;
    const showBestFit  = document.getElementById('showBestFit').checked;
    const showSims     = document.getElementById('showSimulations').checked;
    const rConstrForExp = getRConstr(null);

    const selectedChs = [...selectedChannels.spectral];

    debugLog('=== updateSpectralPlots ===');
    debugLog('Selected channels:', selectedChs);

    if (selectedChs.length === 0) return;

    // Get spectrum index from slider (INDEX-BASED, not time-based)
    const slider = document.getElementById('timeSlider');
    const spectrumIndex  = parseInt(slider.value);
    const spectrumCount  = parseInt(slider.dataset.spectrumCount || '0');

    if (spectrumCount === 0) return;

    // Build experimental + best-fit traces synchronously
    const { tracesZ, tracesPhase, tracesR, tracesC, channelColorMap } =
        _buildSpectralExpTraces(selectedChs, spectrumIndex, showAllTimes, rConstrForExp, showBestFit);

    // Update time display
    updateTimeDisplay();

    const channelLabel = selectedChs.length === 1 ? selectedChs[0] : `${selectedChs.length} channels`;
    const titleSuffix  = showAllTimes ? ' (all times)' : ` [spectrum ${spectrumIndex + 1}/${spectrumCount}]`;

    debugLog(`Total exp traces: Z=${tracesZ.length}`);

    // ── Model curves (CPE + GK) ─────────────────────────────
    _appendModelTraces(tracesZ, tracesPhase, tracesR, tracesC);

    // ── Simulation overlay ──────────────────────────────────
    if (showSims && serverLibrary.connected) {
        // Render experimental first (instant feedback)
        _renderSpectralPlots(tracesZ, tracesPhase, tracesR, tracesC, channelLabel, titleSuffix);

        // Then fetch sim overlay async and re-render
        _fetchAndAppendSimOverlay(tracesZ, tracesPhase, tracesR, tracesC, channelLabel, titleSuffix);
    } else {
        // No sim overlay — render immediately
        _renderSpectralPlots(tracesZ, tracesPhase, tracesR, tracesC, channelLabel, titleSuffix);
    }
}

// ------------------------------------------------------------
// Append CPE and GK model traces to the four trace arrays
// Called before rendering, so model curves appear on top of sims.
// ------------------------------------------------------------
function _appendModelTraces(tracesZ, tracesPhase, tracesR, tracesC) {
    const freqs = experimentalData.frequencies;
    if (!freqs || freqs.length === 0) return;

    // -- CPE model --
    const showCPE = document.getElementById('showCPECurve')?.checked;
    const A = parseFloat(document.getElementById('cpeA')?.value) || 1e-8;
    const B = parseFloat(document.getElementById('cpeB')?.value) || 720;
    const n = parseFloat(document.getElementById('cpeN')?.value) || 0.9;
    const cpeMarker = document.getElementById('cpeMarker')?.value || 'none';
    const cpeDash   = document.getElementById('cpeDash')?.value   || 'dot';

    // ZN_fn for GK: bare CPE only (B=0) because gkZ() adds R_const=B once as a series term.
    // Using cpeZ(f, A, B, n) here would include B twice (once inside ZN, once in gkZ output).
    const ZN_fn = f => cpeZ(f, A, 0, n);

    if (showCPE) {
        const t = buildCPETraces(freqs, A, B, n, '#888888',
            `CPE (A=${A.toExponential(2)}, B=${B}, n=${n})`, cpeMarker, cpeDash);
        tracesZ.push(...t.tracesZ);
        tracesPhase.push(...t.tracesPhase);
        tracesR.push(...t.tracesR);
        tracesC.push(...t.tracesC);
    }

    // -- GK curves --
    // R_const (constriction resistance) = CPE's B, shared across all GK curves.
    (window.gkCurves || []).forEach((curve, idx) => {
        const { alpha, Rb, Cm, ae, color, marker, dash } = curve;
        if (!ae || ae <= 0) return;
        const label = `GK ${idx + 1} (α=${alpha}, Rb=${Rb}, Cm=${Cm?.toExponential(2)})`;
        const t = buildGKTraces(freqs, alpha, Rb, Cm, ZN_fn, B, ae, color, label,
            marker || 'none', dash || 'solid');
        tracesZ.push(...t.tracesZ);
        tracesPhase.push(...t.tracesPhase);
        tracesR.push(...t.tracesR);
        tracesC.push(...t.tracesC);
    });
}

// ------------------------------------------------------------
// Populate Cell Shape and Electrode dropdowns from serverLibrary
// Called once when the overlay panel becomes visible / library connects.
// ------------------------------------------------------------
function initSpectralOverlaySelectors() {
    const shapeEl = document.getElementById('spectralOverlayShape');
    const deEl    = document.getElementById('spectralOverlayElectrode');
    if (!shapeEl || !deEl) return;

    // Populate cell shapes from serverLibrary.params.cell_shapes
    if (serverLibrary?.params?.cell_shapes) {
        const cur = shapeEl.value;
        shapeEl.innerHTML = '<option value="">All</option>' +
            serverLibrary.params.cell_shapes.map(s =>
                `<option value="${s}"${s === cur ? ' selected' : ''}>${s}</option>`
            ).join('');
    }

    // Populate electrode profiles — serverLibrary.params.de_um is a flat array of values;
    // serverLibrary.electrode_profiles is [{de_um, acpe, ncpe, count}, ...] (also available).
    const deValues = serverLibrary?.params?.de_um
                  ?? (serverLibrary?.electrode_profiles ?? []).map(p => p.de_um).filter(v => v != null);
    if (deValues.length > 0) {
        const cur = deEl.value;
        deEl.innerHTML = '<option value="">All</option>' +
            deValues.map(d =>
                `<option value="${d}"${String(d) === cur ? ' selected' : ''}>${d} µm</option>`
            ).join('');
    }
}

// ------------------------------------------------------------
// Update alpha/Rb/Cm option labels with match counts from allMeta
// ------------------------------------------------------------
function _updateOverlayParamLabels(cntAlpha, cntRb, cntCm) {
    const updateSel = (id, counts) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        [...sel.options].forEach(opt => {
            if (opt.value === '') return;
            const n = counts[parseFloat(opt.value)] || 0;
            // Strip existing [N] suffix before re-appending to avoid accumulation
            const baseText = opt.text.replace(/\s*\[\d+\]$/, '');
            opt.text = `${baseText} [${n}]`;
        });
    };
    updateSel('spectralAlpha', cntAlpha);
    updateSel('spectralRb',    cntRb);
    updateSel('spectralCm',    cntCm);
}

// ------------------------------------------------------------
// Async: fetch sim overlay from API and re-render
// ------------------------------------------------------------
async function _fetchAndAppendSimOverlay(tracesZ, tracesPhase, tracesR, tracesC, channelLabel, titleSuffix) {
    try {
        // Populate shape/electrode selectors if not yet done
        if (serverLibrary?.connected) initSpectralOverlaySelectors();

        // Collect filter values from spectral panel dropdowns
        const spectralFilters = getSpectralSimFilters();
        const maxSims = parseInt(document.getElementById('spectralMaxSims')?.value) || 50;

        // Read new shape/electrode selectors
        const overlayShape = document.getElementById('spectralOverlayShape')?.value || '';
        const overlayDe    = document.getElementById('spectralOverlayElectrode')?.value || '';

        // Build per-type filter from spectral sim-type checkboxes
        const types = [];
        if (document.getElementById('simTypeCov')?.checked)  types.push('cov');
        if (document.getElementById('simTypeFus')?.checked)  types.push('fus');
        if (document.getElementById('simTypeWh')?.checked)   types.push('wh');
        if (document.getElementById('simTypeRan')?.checked)  types.push('ran');
        // Legacy names (v7 compatibility checkboxes may still be present)
        if (document.getElementById('simTypeInf')?.checked)  types.push('inf');
        if (document.getElementById('simTypeRup')?.checked)  types.push('rup');

        if (types.length === 0) return;

        // Use apiFilterSimulations with specific overrides for spectral panel values
        const response = await apiFilterSimulations({
            types:       new Set(types),
            alpha:       spectralFilters.alpha !== 0 ? new Set([spectralFilters.alpha]) : serverLibrary.filters.alpha,
            rb:          spectralFilters.rb    !== 0 ? new Set([spectralFilters.rb])    : serverLibrary.filters.rb,
            cm:          spectralFilters.cm    !== 0 ? new Set([spectralFilters.cm])    : serverLibrary.filters.cm,
            cell_shapes: overlayShape ? [overlayShape] : undefined,
            de_um:       overlayDe    ? [parseFloat(overlayDe)] : undefined,
        });

        if (!response || !response.simulations || response.simulations.length === 0) {
            debugLog('Spectral sim overlay: no matching simulations');
            return;
        }

        const allMeta = response.simulations;

        // Build match counts per alpha/rb/cm value and update option labels
        const cntAlpha = {}, cntRb = {}, cntCm = {};
        allMeta.forEach(s => {
            cntAlpha[s.alpha] = (cntAlpha[s.alpha] || 0) + 1;
            cntRb[s.rb]       = (cntRb[s.rb]       || 0) + 1;
            cntCm[s.cm]       = (cntCm[s.cm]       || 0) + 1;
        });
        _updateOverlayParamLabels(cntAlpha, cntRb, cntCm);

        // Fetch impedance for the matched sims (up to maxSims, sorted by step)
        const sortedMeta = allMeta
            .sort((a, b) => (a.step || 0) - (b.step || 0))
            .slice(0, maxSims);

        const ids = sortedMeta.map(s => s.id);
        const impedanceMap = await apiGetImpedanceBatch(ids);

        // Convert metadata + impedance to v7-compatible sim objects
        const simObjects = sortedMeta
            .map(meta => {
                const imp = impedanceMap.get(meta.id);
                if (!imp) return null;
                // impedanceDataToSim() is designed for filter+batch path (no header_json needed)
                return impedanceDataToSim(imp, meta);
            })
            .filter(Boolean);

        debugLog(`Spectral sim overlay: ${simObjects.length} sims fetched`);

        // Append overlay traces and re-render
        _appendSimOverlayTracesV2(tracesZ, tracesPhase, tracesR, tracesC, simObjects);
        _renderSpectralPlots(tracesZ, tracesPhase, tracesR, tracesC, channelLabel, titleSuffix);

    } catch (err) {
        console.warn('Spectral sim overlay fetch failed:', err);
    }
}

// ============================================================
