// ============================================================
// SIMUL_CLASSIFIER — DATA LOADING MODULE
// ============================================================
// Standalone file-based version of v8's dataLoading.js.
//
// Key differences from v8:
//   - "Connect to Library" replaced by simulation file <input>
//   - connectToLibrary() replaced by loadSimulationLibrary()
//   - parseFilename() / parseFileContent() / averageRandomSimulations()
//     live in js/fileParser.js (loaded before this file)
//   - After parsing, calls initLibrary(sims) → api.js populates
//     serverLibrary.params and _simulations[]
//   - All filter UI, live count bar, combination logic, and
//     experimental data loading are IDENTICAL to v8.
//
// Functions preserved verbatim from v8 dataLoading.js:
//   All chip/filter helpers, _getLoadFilters, getSelectedFilters,
//   updateFilterCheckboxes, updateStepFiltersFromFilteredSims,
//   getRConstr, loadRawFiles, parseRawECISFile, processRawData,
//   updateDataSummary, applyChannelNames, autoNumberChannels,
//   updateAllChannelSelectors, _hslToHex, onChannelColorChange,
//   onChannelMarkerChange, onChannelDashChange, onUniformStyleChange,
//   loadSimsForClassification (now operates on _simulations),
//   clearLoadedSims, downloadLoadedSimMetadata, etc.
// ============================================================


// ============================================================
// FILE INPUT — SIMULATION LIBRARY LOADING
// ============================================================

/**
 * Called by the "Load Files" button in the Simulation Library panel.
 * Reads the chosen .txt/.dat files, parses filename + content for each,
 * averages Z_ran groups, assigns sequential IDs, calls initLibrary() to
 * populate serverLibrary and _simulations[], then initialises the filter UI.
 */
async function loadSimulationLibrary() {
    const input = document.getElementById('simLibFileInput');
    if (!input || input.files.length === 0) {
        showStatus('Please select simulation files first', 'error');
        return;
    }

    const files = Array.from(input.files);
    updateLibraryStatus('connecting', 0, '', files.length);

    const btn       = document.getElementById('libLoadBtn');
    const statusEl  = document.getElementById('libConnectLabel');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

    try {
        // Read all files asynchronously
        const parsed = await Promise.all(files.map(file => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = e => {
                const params = parseFilename(file.name);
                if (!params) {
                    debugLog('Skipping unrecognised file:', file.name);
                    resolve(null);
                    return;
                }
                const content = parseFileContent(e.target.result);
                if (content.frequency.length === 0) {
                    console.warn(`No impedance data in ${file.name}`);
                    resolve(null);
                    return;
                }

                // Detect type from filename (override headerData.simType)
                if (file.name.includes('Z_inf'))       content.headerData.simType = 'inf';
                else if (file.name.includes('Z_rup'))  content.headerData.simType = 'rup';
                else if (file.name.includes('Z_ran'))  content.headerData.simType = 'ran';
                else if (file.name.includes('Z_wh'))   content.headerData.simType = 'wh';
                else if (file.name.includes('Z_apo'))  content.headerData.simType = 'apo';

                // For wound healing, use whStage as step
                if (content.headerData.simType === 'wh' && content.headerData.whStage !== undefined) {
                    params.step = content.headerData.whStage;
                }

                resolve({
                    ...params,
                    ...content,
                    rConstr: content.headerData.rConstr || 1000,
                });
            };
            reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
            reader.readAsText(file);
        })));

        const valid = parsed.filter(Boolean);
        if (valid.length === 0) {
            throw new Error('No valid simulation files could be parsed — check filenames follow the expected pattern');
        }

        // Populate apo slot directly (bypasses classification pipeline)
        simulationData.apo = valid.filter(s => s.type === 'apo');

        // Separate ran sims for averaging
        const ranRaw   = valid.filter(s => s.type === 'ran');
        const nonRan   = valid.filter(s => s.type !== 'ran');
        const ranAvg   = averageRandomSimulations(ranRaw);
        const allSims  = [...nonRan, ...ranAvg];

        // Assign sequential IDs (used as keys in the impedance cache)
        allSims.forEach((s, i) => { s.id = i; });

        // Call api.js initLibrary — populates serverLibrary and _simulations
        const params = initLibrary(allSims);

        // Initialise filter UI
        initLibraryUI(params);
        updateLibraryStatus('connected', params.total_simulations);
        document.getElementById('simSelectionPanel').style.display = 'block';

        // Sync load-type checkboxes to types present in files
        _syncLoadTypeCheckboxes(params.types);
        _updateLoadTypeLabels(params);
        _updateLoadFiltersForSelectedTypes();

        showStatus(`Loaded ${params.total_simulations.toLocaleString()} simulations from ${files.length} files`, 'success');

        if (typeof updateCellPopulationPlot === 'function') updateCellPopulationPlot();

    } catch (err) {
        updateLibraryStatus('error', 0, err.message);
        showStatus(`Failed to load simulations: ${err.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Load Files'; }
    }
}


/**
 * Update the connection/loading status indicator.
 * Mirrors v8's updateLibraryStatus() signature for compatibility.
 */
function updateLibraryStatus(state, count = 0, error = '', fileCount = 0) {
    const indicator = document.getElementById('libConnectIndicator');
    const label     = document.getElementById('libConnectLabel');
    if (!indicator || !label) return;

    const states = {
        disconnected: { color: '#9e9e9e', text: 'No files loaded' },
        connecting:   { color: '#ff9800', text: fileCount > 0 ? `Parsing ${fileCount} files…` : 'Loading…' },
        connected:    { color: '#4caf50', text: `${count.toLocaleString()} simulations loaded` },
        error:        { color: '#f44336', text: `Error: ${error}` },
    };

    const s = states[state] || states.disconnected;
    indicator.style.background = s.color;
    label.textContent          = s.text;
}


// ============================================================
// LIBRARY UI INITIALISATION  (identical to v8)
// ============================================================

/**
 * Populate all filter UI elements from the params object returned by initLibrary().
 * Identical to v8 initLibraryUI() — only the data source changed (in-memory vs API).
 */
function initLibraryUI(params) {
    _populateTypeCheckboxes(params.types);
    _populateElectrodeProfiles(params.electrode_profiles ?? []);
    _renderTypeChips(params.types, params.counts_per_type ?? {});

    _buildAnnotatedLoadFilter('loadAcFilters',    'ac',    params.ac,    'load-filter-ac',    v => v.toFixed(2));
    _buildAnnotatedLoadFilter('loadAlphaFilters', 'alpha', params.alpha, 'load-filter-alpha', v => v.toFixed(1));
    _buildAnnotatedLoadFilter('loadRbFilters',    'rb',    params.rb,    'load-filter-rb',    v => v.toFixed(1));
    _buildAnnotatedLoadFilter('loadCmFilters',    'cm',    params.cm,    'load-filter-cm',    v => v.toExponential(2));

    const formatStep = v => v < 0.01 ? v.toExponential(2) : v.toFixed(3);
    const loadStepMap = {
        loadStepWhFilters:  { vals: params.steps.wh  ?? [], cls: 'load-filter-step-wh',  groupId: 'loadStepWhGroup' },
        loadStepRanFilters: { vals: params.steps.ran ?? [], cls: 'load-filter-step-ran', groupId: 'loadStepRanGroup' },
        loadStepFusFilters: {
            vals: [...(params.steps.fus ?? []), ...(params.steps.inf ?? []), ...(params.steps.rup ?? [])],
            cls: 'load-filter-step-fus', groupId: 'loadStepFusGroup'
        },
    };
    for (const [containerId, { vals, cls, groupId }] of Object.entries(loadStepMap)) {
        const sorted = [...new Set(vals)].sort((a, b) => a - b);
        _populateChipFilter(containerId, sorted, cls, formatStep);
        const groupEl = document.getElementById(groupId);
        if (groupEl) groupEl.style.display = sorted.length > 0 ? 'flex' : 'none';
    }

    _populateLoadCellShapeFilter(params.cell_shapes, params.counts_per_shape ?? {});
    _populateLoadHwRatioFilter(params.hw_ratios);
    _updateCellGeometryBlockVisibility();

    document.getElementById('simFiltersPanel')?.style &&
        (document.getElementById('simFiltersPanel').style.display = 'block');

    const bar = document.getElementById('liveCountBar');
    if (bar) bar.style.display = 'flex';
    _scheduleLiveCount();
}

function _populateTypeCheckboxes(types) {
    const typeMap = {
        cov: 'classifyTypeCov',
        wh:  'classifyTypeWh',
        ran: 'classifyTypeRan',
        fus: 'classifyTypeFus',
        inf: 'classifyTypeInf',
        rup: 'classifyTypeRup',
        apo: 'classifyTypeApo',
    };
    Object.values(typeMap).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.closest('label').style.display = 'none';
    });
    types.forEach(t => {
        const el = document.getElementById(typeMap[t]);
        if (el) {
            el.closest('label').style.display = '';
            el.checked = true;
        }
    });
}

function _setRangeHints(param, values, formatter) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const el  = document.getElementById(param + 'Range');
    if (el) el.textContent = `Available: ${formatter(min)} – ${formatter(max)}`;
}

function _populateCellShapeFilter(shapes) {
    const container = document.getElementById('cellShapeFilters');
    if (container) { container.innerHTML = ''; shapes.forEach(s => { const l = document.createElement('label'); l.innerHTML = `<input type="checkbox" checked value="${s}" class="filter-cell-shape"> ${s}`; container.appendChild(l); }); }
    const parent = document.getElementById('cellShapeFilterGroup');
    if (parent) parent.style.display = 'none';
}

function _populateHwRatioFilter(ratios) {
    const container = document.getElementById('hwRatioFilters');
    if (container) { container.innerHTML = ''; ratios.forEach(r => { const l = document.createElement('label'); l.innerHTML = `<input type="checkbox" checked value="${r}" class="filter-hw-ratio"> ${r.toFixed(2)}`; container.appendChild(l); }); }
    const parent = document.getElementById('hwRatioFilterGroup');
    if (parent) parent.style.display = 'none';
}

// ============================================================
// CHIP HELPERS  (identical to v8)
// ============================================================

function _createFilterChip(value, labelHTML, className, checked = true) {
    const chip = document.createElement('label');
    chip.className = 'filter-chip' + (checked ? ' active' : '');

    const cb = document.createElement('input');
    cb.type      = 'checkbox';
    cb.value     = value;
    cb.className = className;
    cb.checked   = checked;
    chip.appendChild(cb);

    const span = document.createElement('span');
    span.innerHTML = labelHTML;
    chip.appendChild(span);

    chip.addEventListener('click', e => {
        e.preventDefault();
        const nowActive = !chip.classList.contains('active');
        chip.classList.toggle('active', nowActive);
        cb.checked = nowActive;
        _scheduleLiveCount();
    });
    return chip;
}

function _populateChipFilter(containerId, values, className, formatter) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    values.forEach(val => container.appendChild(_createFilterChip(val, formatter(val), className, true)));
}

function _chipsSelectAll(className) {
    document.querySelectorAll(`.${className}`).forEach(cb => {
        if (!cb.disabled) { cb.checked = true; cb.closest('.filter-chip')?.classList.add('active'); }
    });
    _scheduleLiveCount();
}

function _chipsSelectNone(className) {
    document.querySelectorAll(`.${className}`).forEach(cb => {
        if (!cb.disabled) { cb.checked = false; cb.closest('.filter-chip')?.classList.remove('active'); }
    });
    _scheduleLiveCount();
}

// ============================================================
// ELECTRODE PROFILE CARDS  (identical to v8)
// ============================================================

function _populateElectrodeProfiles(profiles) {
    const container = document.getElementById('loadProfileCards');
    if (!container) return;
    container.innerHTML = '';

    const block = document.getElementById('loadCpeBlock');
    if (block) block.style.display = profiles.length > 0 ? 'block' : 'none';

    profiles.forEach(p => {
        const card = document.createElement('div');
        card.className = 'profile-card active';

        const deFmt = Number.isInteger(p.de_um) ? p.de_um.toFixed(0) : p.de_um.toFixed(2);

        card.innerHTML = `
            <div class="profile-check"></div>
            <span class="profile-de">${deFmt} µm</span>
            <span class="profile-sep">│</span>
            <span class="profile-acpe">A = ${p.acpe.toExponential(2)} Ω⁻¹·sⁿ</span>
            <span class="profile-sep">│</span>
            <span class="profile-ncpe">n = ${p.ncpe.toFixed(3)}</span>
            <span class="profile-count">${p.count.toLocaleString()} sims</span>
        `;

        const cb = document.createElement('input');
        cb.type           = 'checkbox';
        cb.className      = 'load-filter-profile';
        cb.checked        = true;
        cb.value          = p.de_um;
        cb.dataset.deUm   = p.de_um;
        cb.dataset.acpe   = p.acpe;
        cb.dataset.ncpe   = p.ncpe;
        cb.style.display  = 'none';
        card.appendChild(cb);

        card.addEventListener('click', () => {
            const nowActive = !card.classList.contains('active');
            card.classList.toggle('active', nowActive);
            cb.checked = nowActive;
            _scheduleLiveCount();
        });

        container.appendChild(card);
    });
}

function _profilesSelectAll() {
    document.querySelectorAll('#loadProfileCards .profile-card').forEach(card => {
        card.classList.add('active');
        const cb = card.querySelector('.load-filter-profile');
        if (cb) cb.checked = true;
    });
    _scheduleLiveCount();
}

function _profilesSelectNone() {
    document.querySelectorAll('#loadProfileCards .profile-card').forEach(card => {
        card.classList.remove('active');
        const cb = card.querySelector('.load-filter-profile');
        if (cb) cb.checked = false;
    });
    _scheduleLiveCount();
}

function _updateCpeBlockVisibility() {}

// ============================================================
// SIMULATION TYPE CHIPS  (identical to v8)
// ============================================================

const _TYPE_DISPLAY_MAP = {
    wh:  { full: 'Wound Healing',    abbrev: 'WH',  color: { bg:'#e0f7f4', border:'#20c997', text:'#00796b' } },
    ran: { full: 'Random Death',     abbrev: 'Ran', color: { bg:'#f3e5f5', border:'#6f42c1', text:'#6f42c1' } },
    cov: { full: 'Confluent',        abbrev: 'Cov', color: { bg:'#e8f5e9', border:'#4caf50', text:'#2e7d32' } },
    fus: { full: 'Infected (Fus)',   abbrev: 'Fus', color: { bg:'#fce4ec', border:'#d63384', text:'#c2185b' } },
    inf: { full: 'Infection/Rupture',abbrev: 'Inf', color: { bg:'#fff3e0', border:'#e64a19', text:'#bf360c' } },
    rup: { full: 'Rupture',          abbrev: 'Rup', color: { bg:'#f5f5f5', border:'#9e9e9e', text:'#616161' } },
};

function _renderTypeChips(types, countsPerType) {
    const container = document.getElementById('loadTypeChips');
    if (!container) return;
    container.innerHTML = '';

    const defaultChecked = new Set(['wh', 'ran']);

    types.forEach(type => {
        const info     = _TYPE_DISPLAY_MAP[type] || { full: type, abbrev: type.toUpperCase(), color: { bg:'#eee', border:'#999', text:'#333' } };
        const count    = countsPerType?.[type];
        const countTxt = count != null ? ` [${count.toLocaleString()}]` : '';
        const labelTxt = `${info.full} (${info.abbrev})${countTxt}`;

        const hiddenCb  = document.getElementById(`loadType_${type}`);
        const isChecked = hiddenCb ? hiddenCb.checked : defaultChecked.has(type);
        if (hiddenCb) hiddenCb.checked = isChecked;

        const chip = document.createElement('label');
        chip.className    = 'filter-chip type-chip' + (isChecked ? ' active' : '');
        chip.dataset.type = type;
        chip.style.borderColor = info.color.border;

        const applyColors = active => {
            chip.style.background = active ? info.color.border : info.color.bg;
            chip.style.color      = active ? 'white'          : info.color.text;
        };
        applyColors(isChecked);

        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = isChecked; cb.className = 'load-type-chip-cb';
        chip.appendChild(cb);
        const span = document.createElement('span'); span.textContent = labelTxt;
        chip.appendChild(span);

        chip.addEventListener('click', e => {
            e.preventDefault();
            const nowActive = !chip.classList.contains('active');
            chip.classList.toggle('active', nowActive);
            cb.checked = nowActive;
            applyColors(nowActive);
            const hiddenEl = document.getElementById(`loadType_${type}`);
            if (hiddenEl) hiddenEl.checked = nowActive;
            _updateLoadFiltersForSelectedTypes();
            _scheduleLiveCount();
        });

        container.appendChild(chip);

        const helpableTypes = new Set(['wh', 'ran', 'inf', 'fus', 'rup', 'cov']);
        if (helpableTypes.has(type) && typeof openHelp === 'function') {
            const helpBtn = document.createElement('button');
            helpBtn.className = 'help-btn';
            helpBtn.title = `Help: ${info.full}`;
            helpBtn.textContent = '?';
            const helpKey = type === 'fus' ? 'inf' : type === 'rup' ? 'cld' : type;
            helpBtn.onclick = (e) => { e.stopPropagation(); openHelp(helpKey); };
            container.appendChild(helpBtn);
        }
    });
}

function _loadTypesSelectAll() {
    document.querySelectorAll('#loadTypeChips .type-chip').forEach(chip => {
        const type = chip.dataset.type;
        const info = _TYPE_DISPLAY_MAP[type] || { color: { border:'#1565c0', bg:'#e3f0ff', text:'#1565c0' } };
        chip.classList.add('active');
        chip.style.background = info.color.border;
        chip.style.color = 'white';
        const cb = chip.querySelector('input'); if (cb) cb.checked = true;
        const hiddenEl = document.getElementById(`loadType_${type}`); if (hiddenEl) hiddenEl.checked = true;
    });
    _updateLoadFiltersForSelectedTypes();
    _scheduleLiveCount();
}

function _loadTypesSelectNone() {
    document.querySelectorAll('#loadTypeChips .type-chip').forEach(chip => {
        const type = chip.dataset.type;
        const info = _TYPE_DISPLAY_MAP[type] || { color: { bg:'#eee', text:'#333' } };
        chip.classList.remove('active');
        chip.style.background = info.color.bg;
        chip.style.color = info.color.text;
        const cb = chip.querySelector('input'); if (cb) cb.checked = false;
        const hiddenEl = document.getElementById(`loadType_${type}`); if (hiddenEl) hiddenEl.checked = false;
    });
    _updateLoadFiltersForSelectedTypes();
    _scheduleLiveCount();
}

// ============================================================
// LIVE COUNT  (adapted: calls apiGetFilterCount, which is now in-memory)
// ============================================================

let _liveCountTimer = null;
let _isLoadingSimsForClassification = false;

function _scheduleLiveCount() {
    clearTimeout(_liveCountTimer);
    _liveCountTimer = setTimeout(_updateLiveCount, 280);
}

async function _updateLiveCount() {
    const numEl     = document.getElementById('liveCountNum');
    const barEl     = document.getElementById('liveCountBar');
    const spinnerEl = document.getElementById('liveCountSpinner');
    if (!numEl || !serverLibrary.connected) return;

    if (barEl)     barEl.classList.add('updating');
    if (spinnerEl) spinnerEl.style.display = 'inline';

    try {
        const f = _getLoadFilters();
        const typeMap = {
            loadType_wh:'wh', loadType_ran:'ran', loadType_cov:'cov',
            loadType_fus:'fus', loadType_inf:'inf', loadType_rup:'rup',
        };
        const selectedTypes = Object.entries(typeMap)
            .filter(([id]) => document.getElementById(id)?.checked)
            .map(([, t]) => t);

        const stepsAll = [...new Set([...f.stepsWh, ...f.stepsRan, ...f.stepsInf])];

        const data = await apiGetFilterCount({
            types:       selectedTypes.length ? selectedTypes : undefined,
            ac:          f.ac.length          ? f.ac          : undefined,
            alpha:       f.alpha.length       ? f.alpha       : undefined,
            rb:          f.rb.length          ? f.rb          : undefined,
            cm:          f.cm.length          ? f.cm          : undefined,
            cell_shapes: f.cell_shapes.length ? f.cell_shapes : undefined,
            hw_ratios:   f.hw_ratios.length   ? f.hw_ratios   : undefined,
            steps:       stepsAll.length      ? stepsAll      : undefined,
        });
        numEl.textContent = data.count.toLocaleString();
    } catch (_) {
        numEl.textContent = '?';
    } finally {
        if (barEl)     barEl.classList.remove('updating');
        if (spinnerEl) spinnerEl.style.display = 'none';
    }
}

function _populateLoadCellShapeFilter(shapes, counts = {}) {
    _populateChipFilter('loadCellShapeFilters', shapes, 'load-filter-cell-shape',
        v => counts[v] ? `${v} [${counts[v].toLocaleString('en-US')}]` : v);
    const row = document.getElementById('loadCellShapeRow');
    if (row) row.style.display = shapes.length > 0 ? 'flex' : 'none';
    _populateCellShapeFilter(shapes);
}

function _populateLoadHwRatioFilter(ratios) {
    _populateChipFilter('loadHwRatioFilters', ratios, 'load-filter-hw-ratio', v => v.toFixed(2));
    const row = document.getElementById('loadHwRatioRow');
    if (row) row.style.display = ratios.length > 0 ? 'flex' : 'none';
    _populateHwRatioFilter(ratios);
}

// ============================================================
// TYPE-AWARE PARAMETER FILTER RENDERING  (identical to v8)
// ============================================================

const _MAX_SIMS_PER_TYPE = 20000;
const _BATCH_CHUNK_SIZE  = 500;

const _LOAD_TYPE_COLORS = {
    wh:  { bg: '#e0f7f4', border: '#20c997', text: '#00796b' },
    ran: { bg: '#f3e5f5', border: '#6f42c1', text: '#6f42c1' },
    fus: { bg: '#fce4ec', border: '#d63384', text: '#c2185b' },
    cov: { bg: '#e8f5e9', border: '#4caf50', text: '#2e7d32' },
    inf: { bg: '#fce4ec', border: '#d63384', text: '#c2185b' },
    rup: { bg: '#f5f5f5', border: '#9e9e9e', text: '#616161' },
};

function _strideSelect(arr, maxCount) {
    if (arr.length <= maxCount) return arr;
    const result = [];
    const stride = arr.length / maxCount;
    for (let i = 0; i < maxCount; i++) {
        result.push(arr[Math.round(i * stride)]);
    }
    return result;
}

function _updateLoadTypeLabels(params) {
    // Type chips rendered by _renderTypeChips() already include counts.
}

function _updateCellGeometryBlockVisibility() {
    const shapes = serverLibrary.params?.cell_shapes ?? [];
    const ratios = serverLibrary.params?.hw_ratios   ?? [];
    const outerBlock = document.getElementById('loadCellGeometryBlock');
    if (outerBlock) {
        outerBlock.style.display = (shapes.length > 0 || ratios.length > 0) ? 'block' : 'none';
    }
}

function _buildAnnotatedLoadFilter(containerId, paramName, allValues, className, formatter) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const paramsPerType  = serverLibrary.params?.params_per_type ?? {};
    const hasAnnotations = Object.keys(paramsPerType).length > 0;

    allValues.forEach(val => {
        const typesWithValue = hasAnnotations
            ? Object.entries(paramsPerType)
                .filter(([, tp]) => (tp[paramName] || []).some(v => Math.abs(v - val) < 1e-9))
                .map(([type]) => type)
            : [];

        let labelHTML = `<span style="min-width:38px;display:inline-block;">${formatter(val)}</span>`;
        if (hasAnnotations && typesWithValue.length > 0) {
            typesWithValue.forEach(t => {
                const c = _LOAD_TYPE_COLORS[t] || { bg:'#eee', border:'#999', text:'#333' };
                labelHTML += `<span class="type-badge" data-type="${t}" style="font-size:8.5px;padding:1px 4px;border-radius:8px;background:${c.bg};color:${c.text};border:1px solid ${c.border};font-weight:700;">${t.toUpperCase()}</span>`;
            });
        }

        const chip = _createFilterChip(val, labelHTML, className, true);
        chip.querySelector('input').dataset.typesWithValue = JSON.stringify(typesWithValue);
        container.appendChild(chip);
    });
}

function _updateLoadFiltersForSelectedTypes() {
    const TYPE_ID_MAP = {
        loadType_wh:  'wh',
        loadType_ran: 'ran',
        loadType_cov: 'cov',
        loadType_fus: 'fus',
        loadType_inf: 'inf',
        loadType_rup: 'rup',
    };
    const selectedTypes = Object.entries(TYPE_ID_MAP)
        .filter(([id]) => document.getElementById(id)?.checked)
        .map(([, type]) => type);

    const noFilter = selectedTypes.length === 0;

    ['load-filter-ac', 'load-filter-alpha', 'load-filter-rb', 'load-filter-cm'].forEach(cls => {
        document.querySelectorAll(`.${cls}`).forEach(cb => {
            const typesWithValue = JSON.parse(cb.dataset.typesWithValue || '[]');
            const available = noFilter || typesWithValue.some(t => selectedTypes.includes(t));
            const chip = cb.closest('.filter-chip');
            if (!chip) return;

            if (available) {
                if (cb.disabled) { cb.disabled = false; cb.checked = true; chip.classList.add('active'); }
                chip.style.opacity       = '1';
                chip.style.pointerEvents = '';
                chip.title               = '';
            } else {
                cb.disabled = true; cb.checked = false;
                chip.classList.remove('active');
                chip.style.opacity       = '0.35';
                chip.style.pointerEvents = 'none';
                chip.title               = 'Not available for the selected simulation type(s)';
            }

            chip.querySelectorAll('.type-badge').forEach(badge => {
                badge.style.display = (noFilter || selectedTypes.includes(badge.dataset.type)) ? '' : 'none';
            });
        });
    });

    const steps = serverLibrary.params?.steps;
    if (steps) {
        const stepGroups = {
            loadStepWhGroup:  { types: ['wh'],             has: (steps.wh  || []).length > 0 },
            loadStepRanGroup: { types: ['ran'],             has: (steps.ran || []).length > 0 },
            loadStepFusGroup: {
                types: ['fus', 'inf', 'rup'],
                has: ([...(steps.fus||[]),...(steps.inf||[]),...(steps.rup||[])]).length > 0,
            },
        };
        for (const [groupId, { types, has }] of Object.entries(stepGroups)) {
            const group = document.getElementById(groupId);
            if (group) {
                group.style.display = (types.some(t => selectedTypes.includes(t)) && has) ? 'flex' : 'none';
            }
        }
    }
}

function selectAllLoadFilters() {
    const GK_CLASSES = [
        'load-filter-ac', 'load-filter-alpha', 'load-filter-rb', 'load-filter-cm',
        'load-filter-step-wh', 'load-filter-step-ran', 'load-filter-step-fus',
    ];
    GK_CLASSES.forEach(cls => {
        document.querySelectorAll(`.${cls}`).forEach(cb => {
            if (!cb.disabled) { cb.checked = true; cb.closest('.filter-chip')?.classList.add('active'); }
        });
    });
    _scheduleLiveCount();
}

function deselectAllLoadFilters() {
    const GK_CLASSES = [
        'load-filter-ac', 'load-filter-alpha', 'load-filter-rb', 'load-filter-cm',
        'load-filter-step-wh', 'load-filter-step-ran', 'load-filter-step-fus',
    ];
    GK_CLASSES.forEach(cls => {
        document.querySelectorAll(`.${cls}`).forEach(cb => {
            if (!cb.disabled) { cb.checked = false; cb.closest('.filter-chip')?.classList.remove('active'); }
        });
    });
    _scheduleLiveCount();
}


// ============================================================
// RANGE FILTERS  (stubs — range panel removed in v8 redesign)
// ============================================================

function applyRangeFilters() {}
function resetRangeFilters()  {}
function getRangeFilters()    { return {}; }


// ============================================================
// FILTER CHECKBOX HELPERS  (identical to v8)
// ============================================================

function updateFilterCheckboxes(containerId, values, className, formatter) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    values.forEach(val => {
        const label = document.createElement('label');
        label.style.display = 'block';
        label.style.marginBottom = '2px';
        label.innerHTML = `<input type="checkbox" checked value="${val}" class="${className}"> ${formatter(val)}`;
        container.appendChild(label);
    });
}

function updateStepFiltersFromFilteredSims(filteredSims) {
    const stepByType = { fus: new Set(), wh: new Set(), ran: new Set(), combined: new Set() };

    filteredSims.forEach(sim => {
        const t = sim.type;
        if (sim.isCombined) {
            stepByType.combined.add(sim.step);
        } else if (t === 'fus' || t === 'inf' || t === 'rup') {
            stepByType.fus.add(sim.step);
        } else if (t === 'wh') {
            stepByType.wh.add(sim.step);
        } else if (t === 'ran') {
            stepByType.ran.add(sim.per);
        }
    });

    const fmt = v => v < 0.01 ? v.toExponential(2) : v.toFixed(3);
    updateFilterCheckboxes('stepInfFilters',     [...stepByType.fus].sort((a,b)=>a-b),      'filter-step-inf',      fmt);
    updateFilterCheckboxes('stepWhFilters',       [...stepByType.wh].sort((a,b)=>a-b),       'filter-step-wh',       fmt);
    updateFilterCheckboxes('stepRanFilters',      [...stepByType.ran].sort((a,b)=>a-b),      'filter-step-ran',      fmt);
    updateFilterCheckboxes('stepCombinedFilters', [...stepByType.combined].sort((a,b)=>a-b), 'filter-step-combined', fmt);

    ['stepInfGroup','stepWhGroup','stepRanGroup','stepCombinedGroup'].forEach((id, i) => {
        const key = ['fus','wh','ran','combined'][i];
        const el  = document.getElementById(id);
        if (el) el.style.display = stepByType[key].size > 0 ? 'block' : 'none';
    });
}

function getSelectedFilters() {
    const typeChecked = (id) => document.getElementById(id)?.checked ?? false;

    const types = [];
    if (typeChecked('classifyTypeCov')) types.push('cov');
    if (typeChecked('classifyTypeWh'))  types.push('wh');
    if (typeChecked('classifyTypeRan')) types.push('ran');
    if (typeChecked('classifyTypeFus')) types.push('fus');
    if (typeChecked('classifyTypeInf')) types.push('inf');
    if (typeChecked('classifyTypeRup')) types.push('rup');

    return {
        types,
        ac:    [],
        alpha: [],
        rb:    [],
        cm:    [],
        cell_shapes:    [],
        hw_ratios:      [],
        steps:          [],
        steps_per_type: undefined,
    };
}

function _getLoadFilters() {
    const checked = (cls) => [...document.querySelectorAll(`.${cls}:checked`)].map(el => {
        const v = parseFloat(el.value);
        return isNaN(v) ? el.value : v;
    });

    const selectedProfiles = [...document.querySelectorAll('.load-filter-profile:checked')];
    const de_um = [...new Set(selectedProfiles.map(el => parseFloat(el.dataset.deUm)).filter(v => !isNaN(v)))];
    const acpe  = [...new Set(selectedProfiles.map(el => parseFloat(el.dataset.acpe)).filter(v => !isNaN(v)))];
    const ncpe  = [...new Set(selectedProfiles.map(el => parseFloat(el.dataset.ncpe)).filter(v => !isNaN(v)))];

    const stepsWh  = checked('load-filter-step-wh');
    const stepsRan = checked('load-filter-step-ran');
    const stepsInf = checked('load-filter-step-fus');

    return {
        de_um,
        electrode_shapes: [],
        acpe,
        ncpe,
        ac:          checked('load-filter-ac'),
        alpha:       checked('load-filter-alpha'),
        rb:          checked('load-filter-rb'),
        cm:          checked('load-filter-cm'),
        cell_shapes: checked('load-filter-cell-shape'),
        hw_ratios:   checked('load-filter-hw-ratio'),
        stepsWh, stepsRan, stepsInf,
    };
}

function selectAllFilters() {
    document.querySelectorAll('#classifyTypeCov, #classifyTypeWh, #classifyTypeRan, #classifyTypeFus, #classifyTypeInf, #classifyTypeRup')
        .forEach(el => el.checked = true);
}

function deselectAllFilters() {
    document.querySelectorAll('#classifyTypeCov, #classifyTypeWh, #classifyTypeRan, #classifyTypeFus, #classifyTypeInf, #classifyTypeRup')
        .forEach(el => el.checked = false);
}


// ============================================================
// R_CONSTR HELPER  (identical to v8)
// ============================================================

function getRConstr(sim) {
    const overwriteEnabled = document.getElementById('overwriteRConstr')?.checked;
    if (overwriteEnabled) {
        return parseFloat(document.getElementById('overwriteRConstrValue')?.value) || 0;
    }
    return sim?.headerData?.rConstr ?? sim?.r_constr ?? 0;
}


// ============================================================
// SPECTRUM QUALITY FILTER  (identical to v8)
// ============================================================

function toggleSpectrumFilter() {
    const enabled = document.getElementById('enableSpectrumFilter')?.checked;
    document.getElementById('spectrumFilterOptions').style.display = enabled ? 'block' : 'none';
    if (experimentalData.raw && experimentalData.raw.length > 0) processRawData();
}

function updateSampleFileLink() {
    const fileType = document.getElementById('fileDataType')?.value || 'processed';
    const map = {
        processed:  { file: 'Test_ZP.dat', label: 'Test_ZP.dat' },
        raw:        { file: 'Test_VP.dat', label: 'Test_VP.dat' },
        rc:         { file: 'Test_RC.dat', label: 'Test_RC.dat' },
        magnitude:  { file: 'Test_Z.dat',  label: 'Test_Z.dat'  },
    };
    const { file, label } = map[fileType] ?? map.processed;
    const a = document.getElementById('sampleFileLink');
    if (a) {
        a.href   = `samples/${file}`;
        a.target = '_blank';
        a.removeAttribute('download');
        a.title       = 'View sample file';
        a.textContent = `📄 ${label}`;
    }
}

function updateSpectrumFilterUI() {
    const fileType = document.getElementById('fileDataType')?.value || 'processed';

    const col1 = { raw: 'Voltage', processed: '|Z|', rc: 'R', magnitude: '|Z|' }[fileType] ?? '|Z|';
    const u1   = { raw: 'V',       processed: 'Ω',   rc: 'Ω', magnitude: 'Ω'  }[fileType] ?? 'Ω';
    const col2 = { raw: 'Phase',   processed: 'Phase', rc: 'C', magnitude: '—'  }[fileType] ?? 'Phase';
    const u2   = { raw: '°',       processed: '°',   rc: 'F', magnitude: ''   }[fileType] ?? '°';

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('filterCol1Label',      col1);
    set('filterCol1UnitsLabel', u1);
    set('filterCol1UnitsSuffix', u1);
    set('filterCol2Label',      col2);
    set('filterCol2UnitsLabel', u2);
    set('filterCol2UnitsSuffix', u2);

    const hint = document.getElementById('filterHint');
    if (hint) {
        if (fileType === 'raw')
            hint.textContent = 'Tip: max voltage ~0.095 V usually indicates a disconnected electrode. Set Max in Col 1.';
        else if (fileType === 'rc')
            hint.textContent = 'Filter sweeps by resistance (R) and/or capacitance (C) bounds.';
        else if (fileType === 'magnitude')
            hint.textContent = 'Filter sweeps by |Z| bounds (no phase available for this format).';
        else
            hint.textContent = 'Filter sweeps by |Z| and/or phase bounds.';
    }
}

function sweepPassesQualityFilter(col1Values, col2Values = []) {
    if (!document.getElementById('enableSpectrumFilter')?.checked) return true;

    const col1Min = parseFloat(document.getElementById('filterCol1Min')?.value);
    const col1Max = parseFloat(document.getElementById('filterCol1Max')?.value);
    const col2Min = parseFloat(document.getElementById('filterCol2Min')?.value);
    const col2Max = parseFloat(document.getElementById('filterCol2Max')?.value);

    const hasCol1 = !isNaN(col1Min) || !isNaN(col1Max);
    const hasCol2 = !isNaN(col2Min) || !isNaN(col2Max);

    if (hasCol1) {
        for (const v of col1Values) {
            if (!isNaN(col1Min) && v < col1Min) return false;
            if (!isNaN(col1Max) && v > col1Max) return false;
        }
    }
    if (hasCol2 && col2Values.length > 0) {
        for (const v of col2Values) {
            if (!isNaN(col2Min) && v < col2Min) return false;
            if (!isNaN(col2Max) && v > col2Max) return false;
        }
    }
    return true;
}


// ============================================================
// EXPERIMENTAL DATA LOADING  (identical to v8)
// ============================================================

function loadRawFiles() {
    const input = document.getElementById('rawFileInput');
    const files = Array.from(input.files);
    if (files.length === 0) { showStatus('Please select files first', 'error'); return; }

    const MAX_FILE_SIZE_MB  = 50;
    const ALLOWED_EXTENSIONS = ['.dat', '.txt'];
    const badExt = files.filter(f => !ALLOWED_EXTENSIONS.some(ext => f.name.toLowerCase().endsWith(ext)));
    if (badExt.length > 0) {
        showStatus(`Invalid file type: ${badExt.map(f => f.name).join(', ')}. Only .dat and .txt files are accepted.`, 'error');
        return;
    }
    const tooBig = files.filter(f => f.size > MAX_FILE_SIZE_MB * 1024 * 1024);
    if (tooBig.length > 0) {
        showStatus(`File too large (max ${MAX_FILE_SIZE_MB} MB): ${tooBig.map(f => f.name).join(', ')}`, 'error');
        return;
    }

    experimentalData.raw = [];
    let filesLoaded = 0;

    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            experimentalData.raw.push(parseRawECISFile(e.target.result, file.name));
            if (++filesLoaded === files.length) {
                const fileType = document.getElementById('fileDataType')?.value;
                if (fileType === 'raw') {
                    const rsEl = document.getElementById('rsValue');
                    if (rsEl) {
                        const rsFound = experimentalData.raw.map(f => f.rsFromHeader).find(v => v != null);
                        rsEl.value = rsFound != null ? rsFound : 100000;
                    }
                }
                processRawData();
                showStatus(`Loaded ${files.length} raw file(s)`, 'success');
            }
        };
        reader.readAsText(file);
    });
}

function parseRawECISFile(content, filename) {
    const lines = content.split('\n');
    let numFrequencies = 0, numMeasurements = 0, numChannels = 0, numColumns = 0;
    let dataStartIndex = 0, dateTime = '';
    let rsFromHeader = null;

    for (let i = 0; i < Math.min(30, lines.length); i++) {
        const line = lines[i].trim();
        if (line.includes('Measurement date and time')) {
            dateTime = lines[i + 1]?.trim() || '';
        } else if (line.match(/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/)) {
            dateTime = line;
        }
        const rsAfter  = line.match(/(?:Rs|Load resistance)\s*\[Ohm\][^0-9]*([\d.]+)/i);
        const rsBefore = line.match(/^([\d.]+)\s+#\(\d+\)\s+Load resistance/i);
        if (rsAfter)  rsFromHeader = parseFloat(rsAfter[1]);
        else if (rsBefore) rsFromHeader = parseFloat(rsBefore[1]);

        const firstNum = () => parseInt(line.split(/\t/)[0]) || parseInt(lines[i - 1]);
        if      (line.match(/Number of frequencies/i))   numFrequencies  = firstNum();
        else if (line.match(/Number of measurements/i))  numMeasurements = firstNum();
        else if (line.match(/Number of channels/i))      numChannels     = firstNum();
        else if (line.match(/Number of data columns/i))  numColumns      = firstNum();
        else if (line.startsWith('CH') || line.includes('CH')) { dataStartIndex = i + 1; break; }
        const numVal = parseInt(line);
        if (!isNaN(numVal) && i < 4) {
            if (i === 0) numFrequencies  = numVal;
            else if (i === 1) numMeasurements = numVal;
            else if (i === 2) numChannels    = numVal;
            else if (i === 3) numColumns     = numVal;
        }
    }
    if (dataStartIndex === 0) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith('CH') || lines[i].includes('t [s]')) {
                dataStartIndex = i + 1; break;
            }
        }
    }

    const data = [];
    for (let i = dataStartIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
            const ch    = parseInt(parts[0]);
            const t     = parseFloat(parts[1]);
            const f     = parseFloat(parts[2]);
            const amp   = parseFloat(parts[3]);
            const phase = parts.length >= 5 ? parseFloat(parts[4]) : 0;
            if (!isNaN(ch) && !isNaN(t) && !isNaN(f) && !isNaN(amp) && !isNaN(phase)) {
                data.push({ ch, t, f, amp, phase, magnitudeOnly: parts.length < 5 });
            }
        }
    }

    if (numFrequencies === 0 && data.length > 0) numFrequencies = new Set(data.map(d => d.f)).size;
    if (numChannels    === 0 && data.length > 0) numChannels    = new Set(data.map(d => d.ch)).size;

    debugLog(`[parseRawECISFile] ${filename}: ${data.length} data rows, ${numChannels} ch, ${numFrequencies} freqs`);

    return { filename, dateTime, numFrequencies, numMeasurements, numChannels, numColumns, data, rsFromHeader };
}

function processRawData() {
    if (experimentalData.raw.length === 0) return;

    const fileType = document.getElementById('fileDataType')?.value || 'processed';
    experimentalData.fileType = fileType;
    const Rs = parseFloat(document.getElementById('rsValue')?.value) || 100000;
    const concatenateFiles = document.getElementById('concatenateFiles')?.checked || false;

    if (concatenateFiles && experimentalData.raw.length > 1) {
        experimentalData.raw.sort((a, b) => {
            const parseDate = str => {
                if (!str) return new Date(0);
                const p = str.split(' ');
                if (p.length < 2) return new Date(0);
                const [d, mo, yr] = p[0].split('/').map(Number);
                const [h, mi, s]  = p[1].split(':').map(Number);
                return new Date(yr, mo - 1, d, h, mi, s);
            };
            return parseDate(a.dateTime) - parseDate(b.dateTime);
        });
    }

    let allData = [];
    let cumulativeTimeOffset = 0;
    experimentalData.raw.forEach((file, fileIndex) => {
        const fileData = file.data.map(d => ({
            ...d,
            t: concatenateFiles ? d.t + cumulativeTimeOffset : d.t,
            sourceFile: file.filename,
            fileIndex,
        }));
        allData = allData.concat(fileData);
        if (concatenateFiles && file.data.length > 0) {
            cumulativeTimeOffset += Math.max(...file.data.map(d => d.t));
        }
    });

    const uniqueFreqs    = [...new Set(allData.map(d => d.f))].sort((a, b) => b - a);
    const uniqueChannels = [...new Set(allData.map(d => d.ch))].sort((a, b) => a - b);
    const numFreqs       = uniqueFreqs.length;
    experimentalData.frequencies = uniqueFreqs;

    if (fileType === 'raw') {
        const bareChannel = 0;
        const bareData    = allData.filter(d => d.ch === bareChannel);

        const bareByFreqTime = {};
        bareData.forEach(d => {
            const key = `${d.f}_${Math.round(d.t * 10)}`;
            if (!bareByFreqTime[key]) bareByFreqTime[key] = [];
            bareByFreqTime[key].push(d);
        });

        const nonBareChannels = uniqueChannels.filter(ch => ch !== bareChannel);
        experimentalData.channels  = nonBareChannels.map(ch => `CH${ch}`);
        experimentalData.processed = [];

        nonBareChannels.forEach(ch => {
            const chData = allData.filter(d => d.ch === ch).sort((a, b) => a.t - b.t);

            for (let i = 0; i < chData.length; i += numFreqs) {
                const sweep = chData.slice(i, i + numFreqs);
                if (sweep.length < numFreqs) continue;
                sweep.sort((a, b) => b.f - a.f);
                const sweepTime = Math.max(...sweep.map(d => d.t));

                if (!sweepPassesQualityFilter(sweep.map(d => d.amp), sweep.map(d => d.phase))) continue;

                const frequencies = [], magnitudes = [], phases = [];

                sweep.forEach(meas => {
                    const key = `${meas.f}_${Math.round(meas.t * 10)}`;
                    let bare = bareByFreqTime[key]?.[0];
                    if (!bare) {
                        const bareAtFreq = bareData.filter(d => d.f === meas.f);
                        if (bareAtFreq.length > 0) {
                            bare = bareAtFreq.reduce((closest, b) =>
                                Math.abs(b.t - meas.t) < Math.abs(closest.t - meas.t) ? b : closest
                            );
                        }
                    }
                    if (!bare) return;

                    const Vb = { real: bare.amp * Math.cos(bare.phase * Math.PI / 180), imag: bare.amp * Math.sin(bare.phase * Math.PI / 180) };
                    const Vm = { real: meas.amp  * Math.cos(meas.phase  * Math.PI / 180), imag: meas.amp  * Math.sin(meas.phase  * Math.PI / 180) };
                    const Vd = { real: Vb.real - Vm.real, imag: Vb.imag - Vm.imag };
                    const denom = Vd.real ** 2 + Vd.imag ** 2;
                    if (denom === 0) return;
                    const Zr = Rs * (Vm.real * Vd.real + Vm.imag * Vd.imag) / denom;
                    const Zi = Rs * (Vm.imag * Vd.real - Vm.real * Vd.imag) / denom;

                    frequencies.push(meas.f);
                    magnitudes.push(Math.sqrt(Zr ** 2 + Zi ** 2));
                    phases.push(Math.atan2(Zi, Zr) * 180 / Math.PI);
                });

                if (frequencies.length > 0) {
                    experimentalData.processed.push({
                        channel:     ch,
                        channelName: `CH${ch}`,
                        sweepIndex:  experimentalData.processed.filter(d => d.channel === ch).length,
                        time:        sweepTime,
                        timeHours:   sweepTime / 3600,
                        frequency:   frequencies,
                        magnitude:   magnitudes,
                        phase:       phases,
                        sourceFile:  sweep[0].sourceFile || '',
                        fileIndex:   sweep[0].fileIndex  ?? 0,
                    });
                }
            }
        });

    } else if (fileType === 'rc') {
        experimentalData.channels  = uniqueChannels.map(ch => `CH${ch}`);
        experimentalData.processed = [];

        uniqueChannels.forEach(ch => {
            const chData = allData.filter(d => d.ch === ch).sort((a, b) => a.t - b.t);

            for (let i = 0; i < chData.length; i += numFreqs) {
                const sweep = chData.slice(i, i + numFreqs);
                if (sweep.length < numFreqs) continue;
                sweep.sort((a, b) => b.f - a.f);
                const sweepTime = Math.max(...sweep.map(d => d.t));

                if (!sweepPassesQualityFilter(sweep.map(d => d.amp), sweep.map(d => d.phase))) continue;

                const frequencies = [], magnitudes = [], phases = [];
                sweep.forEach(meas => {
                    const R = meas.amp;
                    const C = meas.phase;
                    if (C === 0 || !isFinite(C)) return;
                    const Zi = -1 / (2 * Math.PI * meas.f * C);
                    frequencies.push(meas.f);
                    magnitudes.push(Math.sqrt(R ** 2 + Zi ** 2));
                    phases.push(Math.atan2(Zi, R) * 180 / Math.PI);
                });

                if (frequencies.length > 0) {
                    experimentalData.processed.push({
                        channel:     ch,
                        channelName: `CH${ch}`,
                        sweepIndex:  experimentalData.processed.filter(d => d.channel === ch).length,
                        time:        sweepTime,
                        timeHours:   sweepTime / 3600,
                        frequency:   frequencies,
                        magnitude:   magnitudes,
                        phase:       phases,
                        sourceFile:  sweep[0].sourceFile || '',
                        fileIndex:   sweep[0].fileIndex  ?? 0,
                    });
                }
            }
        });

    } else if (fileType === 'magnitude') {
        experimentalData.channels  = uniqueChannels.map(ch => `CH${ch}`);
        experimentalData.processed = [];

        uniqueChannels.forEach(ch => {
            const chData = allData.filter(d => d.ch === ch).sort((a, b) => a.t - b.t);

            for (let i = 0; i < chData.length; i += numFreqs) {
                const sweep = chData.slice(i, i + numFreqs);
                if (sweep.length < numFreqs) continue;
                sweep.sort((a, b) => b.f - a.f);
                const sweepTime = Math.max(...sweep.map(d => d.t));

                const sweepMags = sweep.map(d => d.amp);
                if (!sweepPassesQualityFilter(sweepMags)) continue;

                experimentalData.processed.push({
                    channel:       ch,
                    channelName:   `CH${ch}`,
                    sweepIndex:    experimentalData.processed.filter(d => d.channel === ch).length,
                    time:          sweepTime,
                    timeHours:     sweepTime / 3600,
                    frequency:     sweep.map(d => d.f),
                    magnitude:     sweepMags,
                    phase:         sweep.map(() => 0),
                    magnitudeOnly: true,
                    sourceFile:    sweep[0].sourceFile || '',
                    fileIndex:     sweep[0].fileIndex  ?? 0,
                });
            }
        });

    } else {
        experimentalData.channels  = uniqueChannels.map(ch => `CH${ch}`);
        experimentalData.processed = [];

        uniqueChannels.forEach(ch => {
            const chData = allData.filter(d => d.ch === ch).sort((a, b) => a.t - b.t);

            for (let i = 0; i < chData.length; i += numFreqs) {
                const sweep = chData.slice(i, i + numFreqs);
                if (sweep.length < numFreqs) continue;
                sweep.sort((a, b) => b.f - a.f);
                const sweepTime = Math.max(...sweep.map(d => d.t));

                const sweepMags   = sweep.map(d => d.amp);
                const sweepPhases = sweep.map(d => d.phase);
                if (!sweepPassesQualityFilter(sweepMags, sweepPhases)) continue;

                experimentalData.processed.push({
                    channel:     ch,
                    channelName: `CH${ch}`,
                    sweepIndex:  experimentalData.processed.filter(d => d.channel === ch).length,
                    time:        sweepTime,
                    timeHours:   sweepTime / 3600,
                    frequency:   sweep.map(d => d.f),
                    magnitude:   sweepMags,
                    phase:       sweepPhases,
                    sourceFile:  sweep[0].sourceFile || '',
                    fileIndex:   sweep[0].fileIndex  ?? 0,
                });
            }
        });
    }

    experimentalData.timePoints = [...new Set(experimentalData.processed.map(d => d.time))].sort((a, b) => a - b);

    debugLog(`processRawData: ${experimentalData.processed.length} sweeps, type=${fileType}`);

    document.getElementById('channelConfigPanel').style.display = 'block';
    document.getElementById('dataInfo').style.display = 'block';
    updateDataSummary();
    updateAllChannelSelectors();
    if (typeof setupChannelSelectors     === 'function') setupChannelSelectors();
    if (typeof populateFrequencyDropdowns === 'function') populateFrequencyDropdowns();
    showStatus(`Loaded ${experimentalData.processed.length} spectra across ${experimentalData.channels.length} channels`, 'success');
}

function updateDataSummary() {
    const summary = document.getElementById('dataSummary');
    if (!summary) return;

    const numChannels  = experimentalData.channels.length;
    const numTimes     = experimentalData.timePoints.length;
    const numFreqs     = experimentalData.frequencies.length;
    const totalSpectra = experimentalData.processed.length;

    const loadedTotal = ['wh','ran','inf','rup']
        .reduce((s, sl) => s + (simulationData[sl]?.length || 0), 0);
    const numSims = loadedTotal > 0
        ? loadedTotal
        : (serverLibrary.params?.total_simulations ?? 0);

    const spectraPerFile = {}, timesPerFile = {};
    experimentalData.processed.forEach(s => {
        const idx = s.fileIndex ?? 0;
        spectraPerFile[idx] = (spectraPerFile[idx] || 0) + 1;
        if (!timesPerFile[idx]) timesPerFile[idx] = new Set();
        timesPerFile[idx].add(s.time);
    });
    const fileIndices = Object.keys(spectraPerFile).sort((a, b) => a - b);
    const numFiles = fileIndices.length;

    let spectraBreakdown = '', timesBreakdown = '';
    if (numFiles > 1) {
        spectraBreakdown = `<div style="font-size:10px;color:#999;margin-top:2px;">${fileIndices.map(i => spectraPerFile[i]).join(' | ')}</div>`;
        timesBreakdown   = `<div style="font-size:10px;color:#999;margin-top:2px;">${fileIndices.map(i => timesPerFile[i].size).join(' | ')}</div>`;
    }

    const isCombined = originalSimulationData !== null;
    const simBreakdown = [];
    if (loadedTotal > 0) {
        ['wh','ran','inf','rup'].forEach(sl => {
            const n = simulationData[sl]?.length;
            if (n > 0) simBreakdown.push(`${sl}:${n.toLocaleString()}`);
        });
    } else if (serverLibrary.params) {
        Object.keys(serverLibrary.params.steps || {}).forEach(t => simBreakdown.push(t));
    }

    const simCardBg     = loadedTotal > 0 ? (isCombined ? '#fff3e0' : '#e8f5e9') : '#fce4ec';
    const simCardBorder = loadedTotal > 0 ? (isCombined ? 'border:2px solid #ff9800;' : 'border:2px solid #4caf50;') : '';
    const simCardColor  = loadedTotal > 0 ? (isCombined ? '#e65100' : '#2e7d32') : '#c2185b';
    const simCardLabel  = loadedTotal > 0 ? (isCombined ? 'Sims (combined)' : 'Sims (loaded)') : 'Sims (library)';

    summary.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:15px;text-align:center;">
            <div style="padding:15px;background:#e3f2fd;border-radius:8px;">
                <div style="font-size:24px;font-weight:bold;color:#1976d2;">${numChannels}</div>
                <div style="font-size:12px;color:#666;">Channels</div>
            </div>
            <div style="padding:15px;background:#e8f5e9;border-radius:8px;">
                <div style="font-size:24px;font-weight:bold;color:#388e3c;">${numTimes}</div>
                <div style="font-size:12px;color:#666;">Time Points</div>
                ${timesBreakdown}
            </div>
            <div style="padding:15px;background:#fff3e0;border-radius:8px;">
                <div style="font-size:24px;font-weight:bold;color:#f57c00;">${numFreqs}</div>
                <div style="font-size:12px;color:#666;">Frequencies</div>
            </div>
            <div style="padding:15px;background:#f3e5f5;border-radius:8px;">
                <div style="font-size:24px;font-weight:bold;color:#7b1fa2;">${totalSpectra}</div>
                <div style="font-size:12px;color:#666;">Total Spectra</div>
                ${spectraBreakdown}
            </div>
            <div style="padding:15px;background:${simCardBg};border-radius:8px;${simCardBorder}">
                <div style="font-size:24px;font-weight:bold;color:${simCardColor};">${numSims.toLocaleString()}</div>
                <div style="font-size:12px;color:${simCardColor};">${simCardLabel}</div>
                <div style="font-size:10px;color:#999;margin-top:2px;">${simBreakdown.join(' | ')}</div>
            </div>
        </div>
    `;
}

function applyChannelNames() {
    if (!window.channelColors)  window.channelColors  = {};
    if (!window.channelMarkers) window.channelMarkers = {};
    if (!window.channelDashes)  window.channelDashes  = {};

    const inputs = document.querySelectorAll('.channel-name-input');
    inputs.forEach(input => {
        const ch = parseInt(input.dataset.channel);
        const newName = input.value.trim() || `E${ch}`;
        const oldName = experimentalData.processed.find(d => d.channel === ch)?.channelName;
        if (oldName && oldName !== newName) {
            if (window.channelColors[oldName])  { window.channelColors[newName]  = window.channelColors[oldName];  delete window.channelColors[oldName]; }
            if (window.channelMarkers[oldName]) { window.channelMarkers[newName] = window.channelMarkers[oldName]; delete window.channelMarkers[oldName]; }
            if (window.channelDashes[oldName])  { window.channelDashes[newName]  = window.channelDashes[oldName];  delete window.channelDashes[oldName]; }
        }
        const colorPicker  = document.querySelector(`.channel-color-input[data-channel="${ch}"]`);
        const markerSelect = document.querySelector(`.channel-marker-select[data-channel="${ch}"]`);
        const dashSelect   = document.querySelector(`.channel-dash-select[data-channel="${ch}"]`);
        if (colorPicker)  window.channelColors[newName]  = colorPicker.value;
        if (markerSelect) window.channelMarkers[newName] = markerSelect.value;
        if (dashSelect)   window.channelDashes[newName]  = dashSelect.value;
        experimentalData.processed.filter(d => d.channel === ch).forEach(d => d.channelName = newName);
    });
    experimentalData.channels = [...new Set(experimentalData.processed.map(d => d.channelName))].sort();
    updateAllChannelSelectors();
    if (typeof setupChannelSelectors === 'function') setupChannelSelectors();
    showStatus('Channel names applied', 'success');
}

function autoNumberChannels() {
    const channels = [...new Set(experimentalData.processed.map(d => d.channel))].sort((a,b)=>a-b);
    channels.forEach((ch, i) => {
        const input = document.querySelector(`.channel-name-input[data-channel="${ch}"]`);
        if (input) input.value = `E${i + 1}`;
    });
}

function updateAllChannelSelectors() {
    const configContainer = document.getElementById('channelConfigContainer');
    if (configContainer) {
        const channels = [...new Set(experimentalData.processed.map(d => d.channel))].sort((a,b)=>a-b);
        if (!window.channelColors)  window.channelColors  = {};
        if (!window.channelMarkers) window.channelMarkers = {};
        if (!window.channelDashes)  window.channelDashes  = {};

        const _markerOptions = [
            ['circle','● circle'], ['diamond','◆ diamond'], ['square','■ square'],
            ['triangle-up','▲ triangle'], ['cross','✕ cross']
        ];
        const _dashOptions = [
            ['solid','— solid'], ['dash','- - dash'], ['dot','··· dot'], ['dashdot','-· dashdot'],
            ['none','○ none (markers only)']
        ];

        configContainer.innerHTML = channels.map((ch, idx) => {
            const current     = experimentalData.processed.find(d => d.channel === ch)?.channelName || `E${ch}`;
            const autoHue     = (idx * 360 / channels.length) % 360;
            const autoHex     = '#' + _hslToHex(autoHue, 70, 50);
            const savedColor  = window.channelColors[current]  || autoHex;
            const savedMarker = window.channelMarkers[current] || MARKER_CYCLE[idx % MARKER_CYCLE.length];
            const savedDash   = window.channelDashes[current]  || DASH_CYCLE[idx % DASH_CYCLE.length];

            const markerOpts = _markerOptions.map(([v, label]) =>
                `<option value="${v}"${savedMarker === v ? ' selected' : ''}>${label}</option>`
            ).join('');
            const dashOpts = _dashOptions.map(([v, label]) =>
                `<option value="${v}"${savedDash === v ? ' selected' : ''}>${label}</option>`
            ).join('');

            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
                <span style="min-width:55px;color:#666;font-size:0.9em;">Ch ${ch}:</span>
                <input type="text" class="channel-name-input" data-channel="${ch}"
                    value="${current}"
                    style="padding:5px;border:1px solid #ddd;border-radius:4px;width:110px;">
                <input type="color" class="channel-color-input" data-channel="${ch}"
                    value="${savedColor}"
                    title="Channel color"
                    style="width:32px;height:28px;border:none;border-radius:4px;cursor:pointer;padding:1px;"
                    onchange="onChannelColorChange(this)">
                <span class="channel-color-dot" data-channel="${ch}"
                    style="width:14px;height:14px;border-radius:50%;background:${savedColor};
                           display:inline-block;border:1px solid #aaa;flex-shrink:0;"></span>
                <select class="channel-marker-select" data-channel="${ch}"
                    title="Marker symbol"
                    style="padding:3px 4px;border:1px solid #ddd;border-radius:4px;font-size:0.82em;width:90px;"
                    onchange="onChannelMarkerChange(this)">${markerOpts}</select>
                <select class="channel-dash-select" data-channel="${ch}"
                    title="Line style"
                    style="padding:3px 4px;border:1px solid #ddd;border-radius:4px;font-size:0.82em;width:90px;"
                    onchange="onChannelDashChange(this)">${dashOpts}</select>
            </div>`;
        }).join('');
    }

    if (typeof updateSpectralChannelSelector  === 'function') updateSpectralChannelSelector();
    if (typeof updateFittingChannelSelector   === 'function') updateFittingChannelSelector();
    if (typeof updateEvolutionChannelSelector === 'function') updateEvolutionChannelSelector();
}

function _hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `${f(0)}${f(8)}${f(4)}`;
}

function onChannelColorChange(inputEl) {
    const ch = parseInt(inputEl.dataset.channel);
    const hexColor = inputEl.value;
    const chName = experimentalData.processed.find(d => d.channel === ch)?.channelName || `CH${ch}`;
    if (!window.channelColors) window.channelColors = {};
    window.channelColors[chName] = hexColor;
    const dot = inputEl.nextElementSibling;
    if (dot && dot.classList.contains('channel-color-dot')) dot.style.background = hexColor;
    if (typeof updateEvolutionPlots === 'function') updateEvolutionPlots();
    if (typeof updateSpectralPlots  === 'function') updateSpectralPlots();
    if (typeof updateResultsPlots   === 'function') updateResultsPlots();
}

function onChannelMarkerChange(selectEl) {
    const ch = parseInt(selectEl.dataset.channel);
    const chName = experimentalData.processed.find(d => d.channel === ch)?.channelName || `CH${ch}`;
    if (!window.channelMarkers) window.channelMarkers = {};
    window.channelMarkers[chName] = selectEl.value;
    if (typeof updateEvolutionPlots === 'function') updateEvolutionPlots();
    if (typeof updateSpectralPlots  === 'function') updateSpectralPlots();
}

function onChannelDashChange(selectEl) {
    const ch = parseInt(selectEl.dataset.channel);
    const chName = experimentalData.processed.find(d => d.channel === ch)?.channelName || `CH${ch}`;
    if (!window.channelDashes) window.channelDashes = {};
    window.channelDashes[chName] = selectEl.value;
    if (typeof updateEvolutionPlots === 'function') updateEvolutionPlots();
    if (typeof updateSpectralPlots  === 'function') updateSpectralPlots();
}

function onUniformStyleChange() {
    const enabled = document.getElementById('uniformChannelStyle').checked;
    document.getElementById('uniformStylePanel').style.display = enabled ? '' : 'none';
    if (typeof updateEvolutionPlots === 'function') updateEvolutionPlots();
    if (typeof updateSpectralPlots  === 'function') updateSpectralPlots();
}


// ============================================================
// SIMULATION SELECTION  (identical to v8, adapted for in-memory data)
// ============================================================

function _syncLoadTypeCheckboxes(availableTypes) {
    const allTypes = ['wh', 'ran', 'cov', 'fus', 'inf', 'rup', 'apo'];
    allTypes.forEach(type => {
        const el = document.getElementById(`loadType_${type}`);
        if (!el) return;
        if (!availableTypes.includes(type)) el.checked = false;
    });
}

/**
 * Load simulations into simulationData slots from the in-memory _simulations store.
 * In file-based mode, all sims are already in memory; this just moves them into
 * the per-type slots that classification.js and combination.js read.
 */
async function loadSimsForClassification() {
    if (_isLoadingSimsForClassification) return;
    _isLoadingSimsForClassification = true;
    if (!serverLibrary.connected) {
        showStatus('Load simulation files first', 'error');
        _isLoadingSimsForClassification = false;
        return;
    }

    const typeMap = {
        loadType_wh: 'wh', loadType_ran: 'ran', loadType_cov: 'cov',
        loadType_fus: 'fus', loadType_inf: 'inf', loadType_rup: 'rup',
        loadType_apo: 'apo',
    };
    const selectedTypes = Object.entries(typeMap)
        .filter(([id]) => document.getElementById(id)?.checked)
        .map(([, type]) => type);

    if (selectedTypes.length === 0) {
        showStatus('Select at least one simulation type to load', 'error');
        _isLoadingSimsForClassification = false;
        return;
    }

    const btn      = document.getElementById('loadSimsBtn');
    const statusEl = document.getElementById('loadedSimsStatus');
    const warningEl = document.getElementById('loadedSimsWarning');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    if (statusEl)  statusEl.textContent = 'Filtering simulations…';
    if (warningEl) warningEl.style.display = 'none';

    // Clear existing slots
    ['wh', 'ran', 'inf', 'rup', 'apo'].forEach(slot => {
        if (simulationData[slot]) simulationData[slot] = [];
    });

    let totalLoaded = 0;
    const breakdown      = [];
    const strideWarnings = [];

    const loadFilters = _getLoadFilters();

    try {
        for (const type of selectedTypes) {
            if (btn) btn.textContent = `Loading ${type}…`;

            let typeSteps;
            if (type === 'wh')                                           typeSteps = loadFilters.stepsWh;
            else if (type === 'ran')                                     typeSteps = loadFilters.stepsRan;
            else if (type === 'fus' || type === 'inf' || type === 'rup') typeSteps = loadFilters.stepsInf;
            else                                                         typeSteps = [];

            const resp = await apiFilterSimulations({
                types:       new Set([type]),
                ac:          loadFilters.ac.length     ? loadFilters.ac     : undefined,
                alpha:       loadFilters.alpha.length  ? loadFilters.alpha  : undefined,
                rb:          loadFilters.rb.length     ? loadFilters.rb     : undefined,
                cm:          loadFilters.cm.length     ? loadFilters.cm     : undefined,
                cell_shapes: loadFilters.cell_shapes.length ? loadFilters.cell_shapes : undefined,
                hw_ratios:   loadFilters.hw_ratios.length   ? loadFilters.hw_ratios   : undefined,
                steps:       typeSteps.length ? typeSteps : undefined,
                limit: 200000,
            });

            if (!resp || resp.count === 0) {
                debugLog(`loadSimsForClassification: no sims found for type=${type}`);
                continue;
            }

            // Stride-sample if needed
            const allMeta    = resp.simulations;
            const meta       = _strideSelect(allMeta, _MAX_SIMS_PER_TYPE);
            const wasStrided = allMeta.length > meta.length;
            if (wasStrided) {
                strideWarnings.push(
                    `<b>${type}</b>: ${meta.length.toLocaleString()} loaded of ${allMeta.length.toLocaleString()} matching`
                );
            }

            // For in-memory mode, sim objects already have impedance — no batch fetch needed.
            // Use apiGetImpedanceBatch to get the cached ImpedanceData objects, then convert.
            const ids         = meta.map(s => s.id);
            const impedanceMap = await apiGetImpedanceBatch(ids);

            const sims = meta
                .map(m => {
                    const imp = impedanceMap.get(m.id);
                    return imp ? impedanceDataToSim(imp, m) : null;
                })
                .filter(Boolean);

            const slot = _typeToSlot(type);
            if (!simulationData[slot]) simulationData[slot] = [];
            simulationData[slot] = simulationData[slot].concat(sims);

            totalLoaded += sims.length;
            if (wasStrided) {
                breakdown.push(`${type}: ${sims.length.toLocaleString()} of ${allMeta.length.toLocaleString()}`);
            } else {
                breakdown.push(`${type}: ${sims.length.toLocaleString()}`);
            }
        }

        _syncCombineTypeCheckboxes(selectedTypes);

        const doCombine = document.getElementById('enableCombination')?.checked;
        if (doCombine && totalLoaded > 0) {
            if (btn) btn.textContent = 'Combining…';
            _executeCombineLogic();
            const combinedCount = ['wh','ran','inf','rup'].reduce((s, sl) =>
                s + (simulationData[sl]?.filter(x => x.isCombined).length || 0), 0);
            breakdown.push(`→ ${combinedCount.toLocaleString()} combined`);
            totalLoaded = ['wh','ran','inf','rup']
                .reduce((s, sl) => s + (simulationData[sl]?.length || 0), 0);
        }

        updateDataSummary();
        document.getElementById('combinePreview').style.display = 'block';
        updateCombinePreview();

        if (typeof updateClassificationModePanel === 'function') updateClassificationModePanel();

        if (warningEl) {
            if (strideWarnings.length > 0) {
                warningEl.style.display = 'block';
                warningEl.innerHTML =
                    `⚠ <b>Sampling active</b> — filters matched more than ${_MAX_SIMS_PER_TYPE.toLocaleString()} sims/type; ` +
                    `an equispaced sample was loaded:<br>${strideWarnings.join('<br>')}`;
            } else {
                warningEl.style.display = 'none';
            }
        }

        const statusText = `${totalLoaded.toLocaleString()} sims loaded (${breakdown.join(' | ')}) — client-side classification active`;
        if (statusEl) statusEl.textContent = statusText;
        showStatus(statusText, 'success');

        const dlBtn = document.getElementById('downloadSimMetaBtn');
        if (dlBtn) dlBtn.style.display = '';

    } catch (err) {
        const msg = `Failed to load simulations: ${err.message}`;
        if (statusEl) statusEl.textContent = '❌ ' + msg;
        showStatus(msg, 'error');
    } finally {
        _isLoadingSimsForClassification = false;
        if (btn) { btn.disabled = false; btn.textContent = '⬇ Load Simulations'; }
    }
}

function _syncCombineTypeCheckboxes(loadedTypes) {
    const map = { wh:'combineType_wh', ran:'combineType_ran', cov:'combineType_cov', fus:'combineType_fus', inf:'combineType_inf', rup:'combineType_rup' };
    Object.values(map).forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
    loadedTypes.forEach(t => { const el = document.getElementById(map[t]); if (el) el.checked = true; });
}

function clearLoadedSims() {
    ['wh', 'ran', 'inf', 'rup'].forEach(slot => {
        if (simulationData[slot]) simulationData[slot] = [];
    });
    window.originalSimulationData = null;

    const statusEl = document.getElementById('loadedSimsStatus');
    if (statusEl) statusEl.textContent = 'No sims loaded — click "Load Simulations" to populate slots';
    const combinePreview = document.getElementById('combinePreview');
    if (combinePreview) combinePreview.style.display = 'none';

    updateDataSummary();

    if (typeof updateClassificationModePanel === 'function') updateClassificationModePanel();

    const dlBtn = document.getElementById('downloadSimMetaBtn');
    if (dlBtn) dlBtn.style.display = 'none';

    showStatus('Loaded simulations cleared', 'info');
}

function downloadLoadedSimMetadata() {
    const rows = [];
    const SLOTS = ['wh', 'ran', 'inf', 'rup'];

    SLOTS.forEach(slot => {
        (simulationData[slot] || []).forEach(sim => {
            rows.push({
                slot,
                id:          sim.id ?? null,
                ac:          sim.ac ?? null,
                alpha:       sim.alpha ?? null,
                rb:          sim.rb ?? null,
                cm:          sim.cm ?? null,
                step:        sim.step ?? null,
                freq_count:  sim.frequency?.length ?? 0,
                is_combined: !!sim.isCombined,
                src1_val:    sim.isCombined ? (sim.param1 ?? null) : null,
                src2_val:    sim.isCombined ? (sim.param2 ?? null) : null,
            });
        });
    });

    if (rows.length === 0) { alert('No simulations loaded.'); return; }

    const headers = Object.keys(rows[0]);
    const csvLines = [
        headers.join(','),
        ...rows.map(r => headers.map(h => {
            const v = r[h];
            if (v === null || v === undefined) return '';
            const s = String(v);
            return s.includes(',') ? `"${s}"` : s;
        }).join(','))
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `sim_metadata_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}


// ============================================================
// DOMContentLoaded — wire up event listeners
// ============================================================

document.addEventListener('DOMContentLoaded', function () {
    const fileTypeSelect = document.getElementById('fileDataType');
    if (fileTypeSelect) {
        fileTypeSelect.addEventListener('change', function () {
            const rs = document.getElementById('rsInputContainer');
            if (rs) rs.style.display = this.value === 'raw' ? 'inline' : 'none';
            updateSpectrumFilterUI();
        });
        updateSpectrumFilterUI();
        updateSampleFileLink();
    }

    const overwriteCheck = document.getElementById('overwriteRConstr');
    if (overwriteCheck) {
        overwriteCheck.addEventListener('change', function () {
            const container = document.getElementById('overwriteRConstrContainer');
            if (container) container.style.display = this.checked ? 'block' : 'none';
            if (typeof updateSpectralPlots === 'function') updateSpectralPlots();
            if (typeof updateResultsPlots  === 'function') updateResultsPlots();
        });
    }
    const overwriteVal = document.getElementById('overwriteRConstrValue');
    if (overwriteVal) {
        overwriteVal.addEventListener('change', function () {
            if (typeof updateSpectralPlots === 'function') updateSpectralPlots();
            if (typeof updateResultsPlots  === 'function') updateResultsPlots();
        });
    }

    document.querySelectorAll('.load-type').forEach(el => {
        el.addEventListener('change', _updateLoadFiltersForSelectedTypes);
    });

    // File-based mode: start disconnected (no auto-connect)
    updateLibraryStatus('disconnected');
});
