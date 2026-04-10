// ============================================================
// ECIS CLASSIFIER - GLOBAL STATE
// ============================================================
// This file contains all global data structures shared across modules.
// No functions here - only state definitions.
// ============================================================

/**
 * Experimental data from ECIS measurements
 * @property {Array} raw - Raw loaded file data before processing
 * @property {Array} processed - Processed spectra with computed impedance
 * @property {Array} frequencies - Unique frequency points [Hz], sorted descending
 * @property {Array} channels - Channel names (e.g., ["E1", "E2", "CH3"])
 * @property {Array} timePoints - Unique time points [seconds], sorted ascending
 * @property {string} fileType - "raw" (voltage) or "processed" (impedance)
 */
let experimentalData = {
    raw: [],
    processed: [],
    frequencies: [],
    channels: [],
    timePoints: [],
    fileType: 'processed'
};

/**
 * Simulation library organized by type
 * @property {Array} inf - Fusion/infection simulations (Z_inf)
 * @property {Array} rup - Rupture simulations (Z_rup)
 * @property {Array} wh - Wound healing simulations (Z_wh)
 * @property {Array} ran - Random death simulations (Z_ran), averaged by parameters
 */
let simulationData = {
    inf: [],
    rup: [],
    wh: [],
    ran: [],
    apo: []
};

/**
 * Backup of original simulations before electrode combination.
 * Used by resetSimulations() to restore original state.
 */
let originalSimulationData = null;

/**
 * Unique parameter values found across all loaded simulations.
 * Used to populate filter dropdowns.
 */
let uniqueParams = {
    ac: new Set(),      // Cell area [um^2]
    alpha: new Set(),   // Alpha parameter [sqrt(Ohm)*cm]
    rb: new Set(),      // Barrier resistance [Ohm*cm^2]
    cm: new Set(),      // Membrane capacitance [F/cm^2]
    step: new Set()     // Evolution step or percentage
};

/**
 * Currently selected channels per tab.
 * Each tab maintains independent selection.
 */
let selectedChannels = {
    evolution: new Set(),
    spectral: new Set(),
    fitting: new Set()
};

/**
 * Results from classification algorithm.
 * Each entry contains: channel, time, spectrum, bestSim, distance, groupKey, phase
 */
let classificationResults = [];

