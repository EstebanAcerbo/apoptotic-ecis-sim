// ============================================================
// ECIS CLASSIFIER - UI SETUP MODULE
// ============================================================
// Handles UI initialization and interaction:
// - Frequency dropdown population
// - Channel selector setup (tags for each tab)
// - Time slider configuration (index-based, not time-based)
// - Channel toggle behavior
// ============================================================

function populateFrequencyDropdowns() {
    const dropdowns = ['freqZ', 'freqPhase', 'freqR', 'freqC'];
    const freqs = experimentalData.frequencies; // sorted descending (high→low)
    const n = freqs.length;

    // Find index of frequency closest to a target value
    const closestIdx = (target) => {
        let best = 0, bestDist = Infinity;
        freqs.forEach((f, i) => {
            const d = Math.abs(f - target);
            if (d < bestDist) { bestDist = d; best = i; }
        });
        return best;
    };

    // Z, Phase → midpoint of spectrum (balanced view of both regimes)
    // R        → closest to 2000 Hz (low freq, real part dominates)
    // C        → closest to 32000 Hz (high freq, capacitive regime)
    const midIdx = Math.floor(n / 2);
    const defaults = {
        freqZ:     midIdx,
        freqPhase: midIdx,
        freqR:     closestIdx(2000),
        freqC:     closestIdx(32000),
    };

    dropdowns.forEach(id => {
        const dropdown = document.getElementById(id);
        if (!dropdown) return;
        dropdown.innerHTML = '';

        freqs.forEach((freq, idx) => {
            const option = document.createElement('option');
            option.value = idx;
            option.textContent = freq >= 1000
                ? `${(freq / 1000).toFixed(freq >= 10000 ? 0 : 1)} kHz`
                : `${freq.toFixed(0)} Hz`;
            dropdown.appendChild(option);
        });

        dropdown.value = defaults[id] ?? midIdx;
    });
}

function setupChannelSelectors() {
    // Helper: build channel tag element
    const makeTag = (ch, context) => {
        const tag = document.createElement('span');
        tag.className = 'channel-tag selected';
        tag.dataset.channel = ch;  // needed by selectAllChannels/deselectAllChannels
        tag.textContent = ch;
        tag.onclick = function() { toggleChannel(ch, this, context); };
        return tag;
    };

    // Evolution tab - multi-select
    const evoContainer = document.getElementById('evoChannelTags');
    selectedChannels.evolution.clear();
    if (evoContainer) {
        evoContainer.innerHTML = '';
        experimentalData.channels.forEach(ch => {
            evoContainer.appendChild(makeTag(ch, 'evolution'));
            selectedChannels.evolution.add(ch);
        });
    }

    // Spectral tab - multi-select (same as evolution)
    const spectralContainer = document.getElementById('spectralChannelTags');
    selectedChannels.spectral.clear();
    if (spectralContainer) {
        spectralContainer.innerHTML = '';
        experimentalData.channels.forEach(ch => {
            spectralContainer.appendChild(makeTag(ch, 'spectral'));
            selectedChannels.spectral.add(ch);
        });
    }

    // Fitting tab - multi-select
    const fitContainer = document.getElementById('fitChannelTags');
    selectedChannels.fitting.clear();
    if (fitContainer) {
        fitContainer.innerHTML = '';
        experimentalData.channels.forEach(ch => {
            fitContainer.appendChild(makeTag(ch, 'fitting'));
            selectedChannels.fitting.add(ch);
        });
    }
    
    // Setup time slider for spectral tab
    setupTimeSlider();
    
    // Update evolution phases info
    updateTotalSpectraInfo();
    updatePhaseSummary();
    
}

// Setup time slider based on SPECTRUM INDEX (not time value)
// Each channel gets its Nth spectrum, regardless of exact timestamp
function setupTimeSlider() {
    const slider = document.getElementById('timeSlider');
    if (!slider) return;
    
    const selectedChs = [...selectedChannels.spectral];
    if (selectedChs.length === 0) {
        slider.max = 0;
        slider.value = 0;
        slider.dataset.spectrumCount = '0';
        return;
    }
    
    // Count spectra from FIRST selected channel (others may have different counts)
    const firstChannel = selectedChs[0];
    const channelSpectra = experimentalData.processed
        .filter(d => d.channelName === firstChannel)
        .sort((a, b) => a.time - b.time);
    
    const spectrumCount = channelSpectra.length;
    
    if (spectrumCount === 0) {
        slider.max = 0;
        slider.value = 0;
        slider.dataset.spectrumCount = '0';
        return;
    }
    
    // Preserve current index if valid
    const oldIndex = parseInt(slider.value);
    const oldMax = parseInt(slider.max);
    
    slider.min = 0;
    slider.max = spectrumCount - 1;
    slider.dataset.spectrumCount = spectrumCount.toString();
    
    // Keep same index if valid, otherwise reset
    if (oldIndex <= slider.max) {
        slider.value = oldIndex;
    } else {
        slider.value = 0;
    }
    
    // Update labels with time range from first channel
    const timeHoursFirst = channelSpectra[0].time / 3600;
    const timeHoursLast = channelSpectra[spectrumCount - 1].time / 3600;
    document.getElementById('timeSliderMin').textContent = timeHoursFirst.toFixed(2) + ' h';
    document.getElementById('timeSliderMax').textContent = timeHoursLast.toFixed(2) + ' h';
    
    // Show spectra count per file
    updateFileSpectraCounts();
    
    updateTimeDisplay();
}

function updateFileSpectraCounts() {
    const container = document.getElementById('fileSpectraCounts');
    if (!container) return;
    
    const selectedChs = [...selectedChannels.spectral];
    if (selectedChs.length === 0) {
        container.textContent = '';
        return;
    }
    
    // Use first selected channel for counting
    const chName = selectedChs[0];
    const chSpectra = experimentalData.processed
        .filter(d => d.channelName === chName)
        .sort((a, b) => a.time - b.time);
    
    // Count spectra per file
    const fileCounts = {};
    chSpectra.forEach(s => {
        const fileKey = s.fileIndex ?? 0;
        fileCounts[fileKey] = (fileCounts[fileKey] || 0) + 1;
    });
    
    const fileIndices = Object.keys(fileCounts).sort((a, b) => a - b);
    if (fileIndices.length <= 1) {
        container.textContent = `${chSpectra.length} spectra`;
    } else {
        const counts = fileIndices.map(idx => fileCounts[idx]);
        container.textContent = `${chSpectra.length} spectra (${counts.join(' | ')})`;
    }
}

// Update time display when slider moves (shows spectrum index and times per channel)
function updateTimeDisplay() {
    const slider = document.getElementById('timeSlider');
    if (!slider) return;
    
    const spectrumIndex = parseInt(slider.value);
    const spectrumCount = parseInt(slider.dataset.spectrumCount || '0');
    const selectedChs = [...selectedChannels.spectral];
    
    if (spectrumCount === 0 || selectedChs.length === 0) {
        document.getElementById('timePointDisplay').textContent = 'No spectra';
        return;
    }
    
    // Collect actual times for this index from each channel
    const channelTimes = [];
    selectedChs.forEach(chName => {
        const chSpectra = experimentalData.processed
            .filter(d => d.channelName === chName)
            .sort((a, b) => a.time - b.time);
        
        if (spectrumIndex < chSpectra.length) {
            const timeHours = chSpectra[spectrumIndex].time / 3600;
            channelTimes.push({ channel: chName, time: timeHours });
        }
    });
    
    // Build display string
    let displayText = `Spectrum: ${spectrumIndex + 1}/${spectrumCount}`;
    
    if (channelTimes.length > 0) {
        // Check if all times are approximately equal
        const times = channelTimes.map(ct => ct.time);
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        
        if (maxTime - minTime < 0.01) {
            // All times similar - show single time
            displayText += ` | t = ${minTime.toFixed(3)}h`;
        } else {
            // Times differ - show each channel's time
            displayText += ' | ' + channelTimes.map(ct => 
                `${ct.channel}: ${ct.time.toFixed(3)}h`
            ).join(', ');
        }
    }
    
    document.getElementById('timePointDisplay').textContent = displayText;
}

// Navigate time points
function previousTimePoint() {
    const slider = document.getElementById('timeSlider');
    const current = parseInt(slider.value);
    if (current > 0) {
        slider.value = current - 1;
        updateTimeDisplay();
        updateSpectralPlots();
    }
}

function nextTimePoint() {
    const slider = document.getElementById('timeSlider');
    const current = parseInt(slider.value);
    const max = parseInt(slider.max);
    if (current < max) {
        slider.value = current + 1;
        updateTimeDisplay();
        updateSpectralPlots();
    }
}

function toggleChannel(channel, element, context) {
    const set = selectedChannels[context];

    debugLog(`toggleChannel: ${channel}, context: ${context}`);
    debugLog(`Before toggle - Set contents:`, [...set]);

    if (set.has(channel)) {
        set.delete(channel);
        element.classList.remove('selected');
    } else {
        set.add(channel);
        element.classList.add('selected');
    }

    debugLog(`After toggle - Set contents:`, [...set]);

    if (context === 'evolution') {
        updateEvolutionPlots();
    } else if (context === 'spectral') {
        setupTimeSlider();  // Update time slider when channels change
        updateSpectralPlots();
    }
}

/**
 * Select all channels in the given context (evolution | spectral | fitting).
 * Updates both the Set and the tag visual state, then re-renders plots.
 */
function selectAllChannels(context) {
    const containerId = { evolution: 'evoChannelTags', spectral: 'spectralChannelTags', fitting: 'fitChannelTags' }[context];
    const container = document.getElementById(containerId);
    if (!container) return;

    const set = selectedChannels[context];
    container.querySelectorAll('.channel-tag').forEach(tag => {
        const ch = tag.dataset.channel || tag.textContent;
        set.add(ch);
        tag.classList.add('selected');
    });

    if (context === 'evolution') {
        updateEvolutionPlots();
    } else if (context === 'spectral') {
        setupTimeSlider();
        updateSpectralPlots();
    }
}

/**
 * Deselect all channels in the given context.
 */
function deselectAllChannels(context) {
    const containerId = { evolution: 'evoChannelTags', spectral: 'spectralChannelTags', fitting: 'fitChannelTags' }[context];
    const container = document.getElementById(containerId);
    if (!container) return;

    const set = selectedChannels[context];
    container.querySelectorAll('.channel-tag').forEach(tag => {
        const ch = tag.dataset.channel || tag.textContent;
        set.delete(ch);
        tag.classList.remove('selected');
    });

    if (context === 'evolution') {
        updateEvolutionPlots();
    } else if (context === 'spectral') {
        setupTimeSlider();
        updateSpectralPlots();
    }
}

// ============================================================
