// ============================================================
// ECIS CLASSIFIER - UTILITY FUNCTIONS
// ============================================================
// General-purpose functions used across multiple modules.
// ============================================================

// ------------------------------------------------------------
// NUMERIC UTILITIES
// ------------------------------------------------------------

/**
 * Round to 3 decimal places for consistent parameter grouping.
 * Critical for matching simulations with floating-point parameters.
 * @param {number} val - Value to round
 * @returns {number} Rounded value
 */
function round3(val) {
    return Math.round(val * 1000) / 1000;
}

/**
 * Format frequency for display with appropriate unit.
 * @param {number} freq - Frequency in Hz
 * @returns {string} Formatted string (e.g., "4.0 kHz", "250 Hz")
 */
function formatFreq(freq) {
    if (freq >= 1000000) return `${(freq / 1000000).toFixed(1)} MHz`;
    if (freq >= 1000) return `${(freq / 1000).toFixed(1)} kHz`;
    return `${freq.toFixed(0)} Hz`;
}

/**
 * Generate evenly-spaced HSL colors for plotting.
 * If `window.channelColors` is set (map of channelName → hex), those colors
 * take priority over the auto-generated ones.
 *
 * @param {number} n              - Number of colors needed (for auto-generation)
 * @param {string[]} [names]      - Optional channel names array, to look up custom colors
 * @returns {Array<string>} Array of CSS color strings
 */
function generateColors(n, names) {
    const colors = [];
    for (let i = 0; i < n; i++) {
        // Check for user-defined color for this channel
        if (names && window.channelColors && window.channelColors[names[i]]) {
            colors.push(window.channelColors[names[i]]);
        } else {
            const hue = (i * 360 / n) % 360;
            colors.push(`hsl(${hue}, 70%, 50%)`);
        }
    }
    return colors;
}

/**
 * Get the display color for a specific channel name.
 * Returns user-defined color if set, otherwise generates auto color
 * based on the channel's position in experimentalData.channels.
 *
 * @param {string} channelName
 * @returns {string} CSS color string
 */
function getChannelColor(channelName) {
    if (window.channelColors && window.channelColors[channelName]) {
        return window.channelColors[channelName];
    }
    const channels = experimentalData?.channels ?? [];
    const idx = channels.indexOf(channelName);
    const n = channels.length || 1;
    const hue = (Math.max(0, idx) * 360 / n) % 360;
    return `hsl(${hue}, 70%, 50%)`;
}

// ------------------------------------------------------------
// MARKER AND LINESTYLE CYCLES
// ------------------------------------------------------------

/**
 * Plotly marker symbols cycled per channel (5 symbols → repeats every 5).
 * var (not const) so all script files can access it as a global.
 */
var MARKER_CYCLE = ['circle', 'diamond', 'square', 'triangle-up', 'cross'];

/**
 * Plotly line dash styles cycled per channel (4 styles → repeats every 4).
 * Combined with MARKER_CYCLE this gives 20-channel unique combos.
 * var (not const) so all script files can access it as a global.
 * NOTE: 'none' is intentionally excluded — markers-only mode must be set manually.
 */
var DASH_CYCLE = ['solid', 'dash', 'dot', 'dashdot'];

/**
 * Default marker size in pixels. Override via window.globalMarkerSize or the UI input.
 * var (not const) so other scripts can read it as a global.
 */
var GLOBAL_MARKER_SIZE = 6;

/**
 * Get the current global marker size.
 * Reads window.globalMarkerSize if set (e.g. by the UI input), otherwise uses GLOBAL_MARKER_SIZE.
 * @returns {number}
 */
function getMarkerSize() {
    return window.globalMarkerSize != null ? window.globalMarkerSize : GLOBAL_MARKER_SIZE;
}

/**
 * Get the Plotly marker symbol for a channel.
 * If the "Uniform style" toggle is enabled, returns the uniform marker selection.
 * Otherwise returns user-overridden value if set via window.channelMarkers,
 * or auto-cycles by channel position.
 * @param {string} channelName
 * @returns {string} Plotly marker symbol string
 */
function getChannelMarker(channelName) {
    if (document.getElementById('uniformChannelStyle')?.checked)
        return document.getElementById('uniformMarker')?.value || 'circle';
    if (window.channelMarkers && window.channelMarkers[channelName] != null) {
        return window.channelMarkers[channelName];
    }
    const channels = experimentalData?.channels ?? [];
    const idx = channels.indexOf(channelName);
    return MARKER_CYCLE[Math.max(0, idx) % MARKER_CYCLE.length];
}

/**
 * Get the Plotly line dash style for a channel.
 * If the "Uniform style" toggle is enabled, returns the uniform line style selection.
 * Otherwise returns user-overridden value if set via window.channelDashes,
 * or auto-cycles by channel position.
 * @param {string} channelName
 * @returns {string} Plotly dash string ('solid','dash','dot','dashdot')
 */
function getChannelDash(channelName) {
    if (document.getElementById('uniformChannelStyle')?.checked)
        return document.getElementById('uniformLineStyle')?.value || 'solid';
    if (window.channelDashes && window.channelDashes[channelName] != null) {
        return window.channelDashes[channelName];
    }
    const channels = experimentalData?.channels ?? [];
    const idx = channels.indexOf(channelName);
    return DASH_CYCLE[Math.max(0, idx) % DASH_CYCLE.length];
}

// ------------------------------------------------------------
// UI UTILITIES
// ------------------------------------------------------------

/**
 * Switch between application tabs.
 * Updates active states and triggers plot updates for the target tab.
 * @param {string} tabName - Tab identifier ('data', 'evolution', 'spectral', 'fitting')
 */
function switchTab(tabName) {
    // Remove active class from all tabs and content
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
    });

    // Activate selected tab
    document.getElementById(tabName).classList.add('active');
    event.target.classList.add('active');
    event.target.setAttribute('aria-selected', 'true');
    
    // Trigger updates for tabs that need data refresh
    if (tabName === 'evolution') {
        updateEvolutionPlots();
    } else if (tabName === 'spectral') {
        setupTimeSlider();
        updateSpectralPlots();
    }
}

/**
 * Display a status message to the user.
 * Message auto-hides after 5 seconds.
 * @param {string} message - Message text
 * @param {string} type - Message type: 'info', 'success', or 'error'
 */
function showStatus(message, type = 'info') {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.innerHTML = `<div class="status-message ${type}">${message}</div>`;
    setTimeout(() => { statusDiv.innerHTML = ''; }, 5000);
}

// ------------------------------------------------------------
// DEBUG UTILITIES
// ------------------------------------------------------------

/**
 * Debug flag - set to false in production to disable console logs.
 */
const DEBUG_MODE = false;

/**
 * Conditional console log that respects DEBUG_MODE.
 * @param {...any} args - Arguments to log
 */
function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log(...args);
    }
}