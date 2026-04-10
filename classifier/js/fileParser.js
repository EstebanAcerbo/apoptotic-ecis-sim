// ============================================================
// SIMUL_CLASSIFIER — FILE PARSER
// ============================================================
// Standalone functions for parsing simulation filenames and
// file contents into simulation objects ready for initLibrary().
//
// Exported as plain globals (no ES modules) to match the rest
// of the app's script-tag loading model.
// ============================================================


/**
 * Parse simulation filename and extract GK parameters + type.
 *
 * Supported filename patterns:
 *   Z_wh_ac{ac}_n_{n}_Alp{alpha}_Rb{rb}_Cm{cm}_WH{stage}.txt
 *   Z_ran_ac{ac}_n_{n}_Alp{alpha}_Rb{rb}_Cm{cm}_Per{per}_iter{iter}.txt
 *   Z_inf_Rb_ac{ac}_iter{iter}_n_{n}.Alp{alpha}_Rb{rb}_Cm{cm}_Per{per}_step{step}
 *   Z_inf_ac{ac}_iter{iter}_n_{n}_Alp{alpha}_Rb{rb}_Cm{cm}_Per{per}_step{step}
 *   Z_rup_... (same as inf)
 *
 * @param {string} filename
 * @returns {object|null}  Parsed parameter object, or null if unrecognised.
 */
function parseFilename(filename) {
    const convertNum = (str) => parseFloat(str.replace(/_/g, '.'));

    // ===== WOUND HEALING (Z_wh) =====
    // Z_wh_ac1_54_n_30_Alp27_00_Rb50_00_Cm2_00e-06_WH0_0.txt
    // WH can be negative (e.g., WH-1_0)
    let pattern = /Z_wh_ac([\d.]+)_n_(\d+)_Alp([\d.]+)_Rb([\d.]+)_Cm([\d.e+-]+)_WH(-?[\d.]+)/i;
    let match = filename.match(pattern);

    if (match) {
        return {
            type:  'wh',
            ac:    round3(convertNum(match[1])),
            n:     parseInt(match[2]),
            alpha: round3(convertNum(match[3])),
            rb:    round3(convertNum(match[4])),
            cm:    parseFloat(match[5]),
            step:  convertNum(match[6]),   // WH stage (can be negative/decimal)
            iter:  0,
            per:   0,
            filename: filename
        };
    }

    // ===== RANDOM DEATH (Z_ran) =====
    // Z_ran_ac1_54_n_25_Alp10_00_Rb10_00_Cm1_00e-05_Per0_00_iter10.txt
    pattern = /Z_ran_ac([\d.]+)_n_(\d+)_Alp([\d.]+)_Rb([\d.]+)_Cm([\d.e+-]+)_Per([\d.]+)_iter(\d+)/i;
    match = filename.match(pattern);

    if (match) {
        return {
            type:  'ran',
            ac:    round3(parseFloat(match[1])),
            n:     parseInt(match[2]),
            alpha: round3(parseFloat(match[3])),
            rb:    round3(parseFloat(match[4])),
            cm:    parseFloat(match[5]),
            per:   round3(parseFloat(match[6])),
            step:  round3(parseFloat(match[6])),
            iter:  parseInt(match[7]),
            filename: filename
        };
    }

    // ===== INFECTION / RUPTURE (Z_inf, Z_rup) =====
    // Pattern 1: Full format with _Rb suffix
    pattern = /Z_(inf_Rb|inf|rup)_ac(\d+(?:.\d+)?)_iter(\d+)_n_(\d+).Alp(\d+(?:.\d+)?)_Rb(\d+(?:.\d+)?)_Cm(\d+(?:.\d+)?(?:e[+-]?\d+)?)_Per(\d+(?:.\d+)?)_step(\d+)/i;
    match = filename.match(pattern);

    if (!match) {
        // Pattern 2: Without _Rb suffix
        pattern = /Z_(inf|rup)_ac(\d+(?:.\d+)?)_iter(\d+)_n_(\d+)_Alp(\d+(?:.\d+)?)_Rb(\d+(?:.\d+)?)_Cm(\d+(?:.\d+)?(?:e[+-]?\d+)?)_Per(\d+(?:.\d+)?)_step(\d+)/i;
        match = filename.match(pattern);
    }

    if (match) {
        return {
            type:  match[1].toLowerCase().includes('inf') ? 'inf' : 'rup',
            ac:    round3(convertNum(match[2])),
            iter:  parseInt(match[3]),
            n:     parseInt(match[4]),
            alpha: round3(convertNum(match[5])),
            rb:    round3(convertNum(match[6])),
            cm:    parseFloat(match[7]),
            per:   round3(convertNum(match[8])),
            step:  parseInt(match[9]),
            filename: filename
        };
    }

    // ===== APOPTOSIS (Z_apo) =====
    pattern = /Z_apo_ac([\d.]+)_n_(\d+)_Alp([\d.]+)_Rb([\d.]+)_Cm([\d.e+-]+)_Per([\d.]+)_step(\d+)_iter(\d+)/i;
    match = filename.match(pattern);
    if (match) {
        return {
            type:  'apo',
            ac:    round3(parseFloat(match[1])),
            n:     parseInt(match[2]),
            alpha: round3(parseFloat(match[3])),
            rb:    round3(parseFloat(match[4])),
            cm:    parseFloat(match[5]),
            per:   round3(parseFloat(match[6])),
            step:  parseInt(match[7]),
            iter:  parseInt(match[8]),
            filename: filename
        };
    }

    console.warn('Could not parse simulation filename:', filename);
    return null;
}


/**
 * Parse simulation file content (header metadata + frequency/impedance arrays).
 *
 * The header section precedes the line starting with "MEA".
 * Each data line has the form:
 *   <idx>  <something>  <freq>  (<real><+/-imag>j)
 *
 * @param {string} content  Raw file text.
 * @returns {{ frequency: number[], impedance: {real,imag}[], headerData: object }}
 */
function parseFileContent(content) {
    const lines = content.split('\n');
    let dataStartIndex = 0;

    const headerData = {
        step:              0,
        totalCells:        729,
        aliveCells:        0,
        deadCells:         0,
        fusedCells:        0,
        initialInfection:  0,
        electrodeCells:    0,
        coverage:          0,
        rConstr:           1000,
        cellsOnElectrode:  0,
        simType:           '',
        whStage:           0,
        apoStage10:        0,
        apoStage7:         0,
        apoStage5:         0,
        apoStage21:        0,
        apoTotal:          0,
        apoStages:         [],   // [{label:'1st', count:N}, ...] — dynamic, any stage count
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('MEA')) {
            dataStartIndex = i + 1;
            break;
        }

        const stepMatch = line.match(/^Step\s*=\s*(\d+)/);
        if (stepMatch) headerData.step = parseInt(stepMatch[1]);

        const cultureMatch = line.match(/Culture size:\s*(\d+)\s*cells/);
        if (cultureMatch) headerData.totalCells = parseInt(cultureMatch[1]);

        const aliveMatch = line.match(/Alive cells:\s*(\d+)/);
        if (aliveMatch) headerData.aliveCells = parseInt(aliveMatch[1]);

        const deadMatch = line.match(/Dead cells:\s*(\d+)/);
        if (deadMatch) headerData.deadCells = parseInt(deadMatch[1]);

        const fusedMatch = line.match(/Fused cells:\s*(\d+)/);
        if (fusedMatch) headerData.fusedCells = parseInt(fusedMatch[1]);

        const initInfMatch = line.match(/Initial infection:\s*(\d+)/);
        if (initInfMatch) headerData.initialInfection = parseInt(initInfMatch[1]);

        const electrodeMatch = line.match(/Electrode cells:\s*(\d+)/);
        if (electrodeMatch) headerData.electrodeCells = parseInt(electrodeMatch[1]);

        const coverageMatch = line.match(/Cells on electrode:\s*(\d+)\s*\(([\d.]+)%/);
        if (coverageMatch) {
            headerData.cellsOnElectrode = parseInt(coverageMatch[1]);
            headerData.coverage = parseFloat(coverageMatch[2]);
        }

        const rConstrMatch = line.match(/R_constr:\s*([\d.]+)/);
        if (rConstrMatch) headerData.rConstr = parseFloat(rConstrMatch[1]);

        const ACPEMatch = line.match(/^A:\s*([+-]?[\d.]+(?:e[+-]?\d+)?)/i);
        if (ACPEMatch) headerData.ACPE = parseFloat(ACPEMatch[1]);

        const nCPEMatch = line.match(/^n:\s*([\d.]+)/);
        if (nCPEMatch) headerData.nCPE = parseFloat(nCPEMatch[1]);

        const rhoMatch = line.match(/Medium resistivity:\s*([\d.]+)/);
        if (rhoMatch) headerData.rho = parseFloat(rhoMatch[1]);

        const deMatch = line.match(/Electrode diameter:\s*([\d.]+)/);
        if (deMatch) headerData.de = parseFloat(deMatch[1]);

        // Wound healing stage (can be negative)
        const whMatch = line.match(/Wound & Healing stage:\s*([-\d.]+)/);
        if (whMatch) headerData.whStage = parseFloat(whMatch[1]);

        // Apoptosis stages line: "Apoptosis stages: [1st: 3 (0.7%)  2nd: 2 (0.5%)  ...]"
        // Parsed dynamically — works for any number of stages with any label.
        const apoStagesMatch = line.match(/^Apoptosis stages:\s*\[(.+)\]/);
        if (apoStagesMatch) {
            const stagesStr = apoStagesMatch[1];
            const stageRe = /(\w+):\s*(\d+)/g;
            let sm;
            headerData.apoStages = [];
            while ((sm = stageRe.exec(stagesStr)) !== null) {
                headerData.apoStages.push({ label: sm[1], count: parseInt(sm[2]) });
            }
        }
        const apoTotalMatch = line.match(/^Total apoptosis cells:\s*(\d+)/);
        if (apoTotalMatch) headerData.apoTotal = parseInt(apoTotalMatch[1]);

        // Initial dead cells (for Z_rup)
        const initDeadMatch = line.match(/Initial dead cells:\s*(\d+)/);
        if (initDeadMatch) headerData.initialDeadCells = parseInt(initDeadMatch[1]);
    }

    const frequency = [];
    const impedance = [];

    for (let i = dataStartIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
            const freq = parseFloat(parts[2]);
            const zStr = parts[3];

            // Parse complex number of the form (real+imagj) or (real-imagj).
            // The old pattern [0-9.eE+-]+ was greedy and mis-parsed Z values
            // where both the real and imaginary parts use scientific notation
            // (e.g. "1.5e+04+2.3e+02j"): the + inside "e+04" would be consumed
            // by the first group, leaving the imaginary part as "+02".
            // The fixed pattern matches each part as: optional sign, mantissa,
            // optional exponent — so the separator +/- is unambiguous.
            const zMatch = zStr.match(
                /\(?\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([+-](?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)j\s*\)?/
            );
            if (zMatch) {
                const real = parseFloat(zMatch[1]);
                const imag = parseFloat(zMatch[2]);
                frequency.push(freq);
                impedance.push({ real, imag });
            }
        }
    }

    return { frequency, impedance, headerData };
}


/**
 * Average Z_ran simulations that share the same (ac, alpha, rb, cm, per) parameters.
 * Each group reduces to one averaged sim. The source array is not mutated.
 *
 * @param {Array} ranSims  Array of Z_ran simulation objects.
 * @returns {Array}        Array of averaged simulation objects.
 */
function averageRandomSimulations(ranSims) {
    if (!ranSims || ranSims.length === 0) return [];

    const groups = {};
    ranSims.forEach(sim => {
        const key = `ac${sim.ac}_alpha${sim.alpha}_rb${sim.rb}_cm${sim.cm}_per${sim.per}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(sim);
    });

    const averaged = [];
    Object.entries(groups).forEach(([, sims]) => {
        if (sims.length === 0) return;

        const first    = sims[0];
        const numFreqs = first.frequency.length;

        const avgReal = new Array(numFreqs).fill(0);
        const avgImag = new Array(numFreqs).fill(0);

        sims.forEach(sim => {
            sim.impedance.forEach((z, i) => {
                avgReal[i] += z.real / sims.length;
                avgImag[i] += z.imag / sims.length;
            });
        });

        averaged.push({
            ...first,
            iter:        sims.length,
            is_averaged: true,
            impedance:   avgReal.map((r, i) => ({ real: r, imag: avgImag[i] })),
            headerData:  {
                ...first.headerData,
                aliveCells: Math.round(sims.reduce((s, sim) => s + (sim.headerData?.aliveCells || 0), 0) / sims.length),
                deadCells:  Math.round(sims.reduce((s, sim) => s + (sim.headerData?.deadCells  || 0), 0) / sims.length),
            },
        });
    });

    debugLog(`averageRandomSimulations: ${Object.keys(groups).length} parameter combinations`);
    return averaged;
}
