// ============================================================
// ECIS CLASSIFIER - MODEL CURVES
// ============================================================
// JavaScript ports of CPE and GK (Giaever-Keese) impedance models.
// Based on CPE_GK_Funs.py.
//
// CPE model:  Z = 1/(A*(j*omega)^n) + B
// GK model:   full Giaever-Keese formula using modified Bessel functions
// ============================================================

// ------------------------------------------------------------
// Complex arithmetic helpers (prefix _c to avoid clashes)
// ------------------------------------------------------------

function _cAdd(a, b)  { return { re: a.re + b.re, im: a.im + b.im }; }
function _cSub(a, b)  { return { re: a.re - b.re, im: a.im - b.im }; }
function _cMul(a, b)  { return { re: a.re*b.re - a.im*b.im, im: a.re*b.im + a.im*b.re }; }
function _cDiv(a, b)  {
    const d = b.re*b.re + b.im*b.im;
    return { re: (a.re*b.re + a.im*b.im)/d, im: (a.im*b.re - a.re*b.im)/d };
}
function _cScale(a, s) { return { re: a.re*s, im: a.im*s }; }
function _cRecip(a)   {
    const d = a.re*a.re + a.im*a.im;
    return { re: a.re/d, im: -a.im/d };
}
function _cSqrt(a) {
    const r = Math.sqrt(Math.hypot(a.re, a.im));
    const theta = Math.atan2(a.im, a.re) / 2;
    return { re: r * Math.cos(theta), im: r * Math.sin(theta) };
}

// ------------------------------------------------------------
// Modified Bessel functions I_0(z) and I_1(z) for complex z
// Power series (converges for all z; 40 terms gives ~15-digit accuracy):
//   I_0(z) = sum_{k=0}^inf  (z/2)^{2k}   / (k!)^2
//   I_1(z) = sum_{k=0}^inf  (z/2)^{2k+1} / (k! * (k+1)!)
// ------------------------------------------------------------

function _cBesselI0(z) {
    const zh = _cScale(z, 0.5);
    let sum  = { re: 1, im: 0 };
    let term = { re: 1, im: 0 };
    for (let k = 1; k <= 40; k++) {
        term = _cMul(term, _cMul(zh, zh));
        term = _cScale(term, 1 / (k * k));
        sum  = _cAdd(sum, term);
        if (Math.hypot(term.re, term.im) < 1e-15 * Math.hypot(sum.re, sum.im)) break;
    }
    return sum;
}

function _cBesselI1(z) {
    const zh = _cScale(z, 0.5);
    let sum  = { re: zh.re, im: zh.im };
    let term = { re: zh.re, im: zh.im };
    for (let k = 1; k <= 40; k++) {
        term = _cMul(term, _cMul(zh, zh));
        term = _cScale(term, 1 / (k * (k + 1)));
        sum  = _cAdd(sum, term);
        if (Math.hypot(term.re, term.im) < 1e-15 * Math.hypot(sum.re, sum.im)) break;
    }
    return sum;
}

// ------------------------------------------------------------
// CPE model
// Z_CPE(f) = 1 / (A * (j*omega)^n) + B   [Ohm]
//
//   A  [Ohm^-1 * s^n]  — CPE coefficient
//   B  [Ohm]           — series (constriction) resistance
//   n  []              — CPE exponent (0 < n < 1)
// ------------------------------------------------------------

/**
 * Return complex CPE impedance {re, im} in [Ohm] for frequency f [Hz].
 */
function cpeZ(f, A, B, n) {
    const omega  = 2 * Math.PI * f;
    // (j*omega)^n = omega^n * exp(j*n*pi/2)
    const omegan = Math.pow(omega, n);
    const jn = { re: Math.cos(n * Math.PI / 2), im: Math.sin(n * Math.PI / 2) };
    // A * (j*omega)^n
    const denom = _cScale(jn, A * omegan);
    // 1 / denom
    const inv   = _cRecip(denom);
    // + B
    return { re: inv.re + B, im: inv.im };
}

// ------------------------------------------------------------
// GK (Giaever-Keese) model
// Direct port of GKSpectre() from CPE_GK_Funs.py.
//
// Returns total impedance {re, im} in [Ohm].
//
//   alpha  [(Ohm*cm)^0.5 = sqrt(Ohm)*cm]  — cell-substrate coupling
//   Rb     [Ohm*cm^2]                     — barrier (paracellular) resistance
//   Cm     [F/cm^2]                        — membrane capacitance
//   ZN_fn  function(f) -> {re,im} [Ohm]   — naked electrode impedance (total)
//   f      [Hz]                            — frequency (scalar)
//   R_const [Ohm]                          — series constriction resistance
//   ae     [cm^2]                          — electrode area
// ------------------------------------------------------------

function gkZ(f, alpha, Rb, Cm, ZN_fn, R_const, ae) {
    // Specific naked electrode impedance [Ohm*cm^2] = Z_total * ae
    const ZN = _cScale(ZN_fn(f), ae);

    // Specific membrane impedance [Ohm*cm^2]
    // ZM = -j / (2*pi * (Cm/2) * f)
    const ZM = { re: 0, im: -1 / (2 * Math.PI * (Cm / 2) * f) };

    // gamma_rc = alpha * sqrt(1/ZN + 1/ZM)
    const invZN   = _cRecip(ZN);
    const invZM   = _cRecip(ZM);
    const admSum  = _cAdd(invZN, invZM);             // 1/ZN + 1/ZM
    const gamma_rc = _cScale(_cSqrt(admSum), alpha);  // alpha * sqrt(...)

    // Modified Bessel functions
    const I0 = _cBesselI0(gamma_rc);
    const I1 = _cBesselI1(gamma_rc);

    // Z_cov = ( (ZN*(ZN+ZM)) / (ZN + ZM/(0.5*gamma_rc*I0/I1 + Rb*(1/ZN+1/ZM))) ) / ae
    const ZNplusZM   = _cAdd(ZN, ZM);
    const numerator  = _cMul(ZN, ZNplusZM);

    // inner denominator:  0.5 * gamma_rc * I0/I1  +  Rb * (1/ZN + 1/ZM)
    const half_grc_ratio = _cScale(_cMul(gamma_rc, _cDiv(I0, I1)), 0.5);
    const Rb_term        = _cScale(admSum, Rb);
    const inner_denom    = _cAdd(half_grc_ratio, Rb_term);

    // ZM / inner_denom
    const ZM_over_inner = _cDiv(ZM, inner_denom);

    // outer denominator: ZN + ZM/inner_denom
    const outer_denom = _cAdd(ZN, ZM_over_inner);

    // Z_cov [Ohm] = numerator / outer_denom / ae
    const Z_cov = _cScale(_cDiv(numerator, outer_denom), 1 / ae);

    // Add R_const to real part
    return { re: Z_cov.re + R_const, im: Z_cov.im };
}

// ------------------------------------------------------------
// Convert Z array to magnitude, phase, R, C (same as in spectral.js)
// freqs: array [Hz], zArr: array of {re, im} [Ohm]
// ------------------------------------------------------------

function _zArrayToBode(freqs, zArr) {
    const mag   = [], phase = [], R = [], C = [];
    freqs.forEach((f, i) => {
        const z = zArr[i];
        if (!z) { mag.push(null); phase.push(null); R.push(null); C.push(null); return; }
        const m = Math.hypot(z.re, z.im);
        const p = Math.atan2(z.im, z.re) * 180 / Math.PI;
        const c = z.im < 0 ? -1 / (2 * Math.PI * f * z.im) : null;
        mag.push(m); phase.push(p); R.push(z.re); C.push(c);
    });
    return { mag, phase, R, C };
}

// ------------------------------------------------------------
// Build CPE traces for all four spectral plots
// Returns {tracesZ, tracesPhase, tracesR, tracesC} to append.
// marker: Plotly marker symbol, or 'none' (default — no markers)
// dash:   Plotly dash style, or 'none' (no line, markers only); default 'dot'
// ------------------------------------------------------------

function buildCPETraces(freqs, A, B, n, color, label, marker, dash) {
    marker = marker || 'none';
    dash   = dash   || 'dot';
    const zArr = freqs.map(f => cpeZ(f, A, B, n));
    const { mag, phase, R, C } = _zArrayToBode(freqs, zArr);
    const hasLine   = dash !== 'none';
    const hasMarker = marker !== 'none';
    const base = {
        mode: hasLine && hasMarker ? 'lines+markers' : hasLine ? 'lines' : 'markers',
        name: label,
        ...(hasLine ? { line: { color, width: 2, dash } } : {}),
        marker: { color, size: 6, symbol: hasMarker ? marker : 'circle', opacity: hasMarker ? 1 : 0 },
        showlegend: true
    };
    return {
        tracesZ:     [{ ...base, x: freqs, y: mag   }],
        tracesPhase: [{ ...base, x: freqs, y: phase  }],
        tracesR:     [{ ...base, x: freqs, y: R      }],
        tracesC:     [{ ...base, x: freqs, y: C      }],
    };
}

// ------------------------------------------------------------
// Build GK traces for all four spectral plots
// ZN_fn: function(f) -> {re,im}  (e.g. wrapping cpeZ)
// marker: Plotly marker symbol, or 'none' (default — no markers)
// dash:   Plotly dash style, or 'none'; default 'solid'
// ------------------------------------------------------------

function buildGKTraces(freqs, alpha, Rb, Cm, ZN_fn, R_const, ae, color, label, marker, dash) {
    marker = marker || 'none';
    dash   = dash   || 'solid';
    const zArr = freqs.map(f => {
        try { return gkZ(f, alpha, Rb, Cm, ZN_fn, R_const, ae); }
        catch (e) { return null; }
    });
    const { mag, phase, R, C } = _zArrayToBode(freqs, zArr);
    const hasLine   = dash !== 'none';
    const hasMarker = marker !== 'none';
    const base = {
        mode: hasLine && hasMarker ? 'lines+markers' : hasLine ? 'lines' : 'markers',
        name: label,
        ...(hasLine ? { line: { color, width: 2.5, dash } } : {}),
        marker: { color, size: 6, symbol: hasMarker ? marker : 'circle', opacity: hasMarker ? 1 : 0 },
        showlegend: true
    };
    return {
        tracesZ:     [{ ...base, x: freqs, y: mag   }],
        tracesPhase: [{ ...base, x: freqs, y: phase  }],
        tracesR:     [{ ...base, x: freqs, y: R      }],
        tracesC:     [{ ...base, x: freqs, y: C      }],
    };
}

// ------------------------------------------------------------
// GK curve list management
// window.gkCurves = [ { alpha, Rb, Cm, ae, color, marker, dash } ]
// R_s (constriction resistance) is shared with CPE's B parameter —
// it is NOT stored per-curve; _appendModelTraces passes CPE B directly.
// ------------------------------------------------------------

window.gkCurves = window.gkCurves || [];

// Shared marker/dash option lists for GK curve rows
const _GK_MARKER_OPTIONS = [
    ['none','○ none'], ['circle','● circle'], ['diamond','◆ diamond'],
    ['square','■ square'], ['triangle-up','▲ triangle'], ['cross','✕ cross']
];
const _GK_DASH_OPTIONS = [
    ['solid','— solid'], ['dash','- - dash'], ['dot','··· dot'],
    ['dashdot','-· dashdot'], ['none','× none']
];

function addGKCurve() {
    const idx = window.gkCurves.length;
    const colors = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e'];
    window.gkCurves.push({
        alpha:  20,
        Rb:     50,
        Cm:     1e-6,
        ae:     5e-4,
        color:  colors[idx % colors.length],
        marker: 'none',
        dash:   'solid',
    });
    renderGKCurvesList();
    updateSpectralPlots();
}

function removeGKCurve(idx) {
    window.gkCurves.splice(idx, 1);
    renderGKCurvesList();
    updateSpectralPlots();
}

function renderGKCurvesList() {
    const container = document.getElementById('gkCurvesList');
    if (!container) return;

    if (window.gkCurves.length === 0) {
        container.innerHTML = '<div style="color:#aaa;font-size:12px;padding:4px 0;">No GK curves added yet.</div>';
        return;
    }

    const _sel = (opts, val) => opts.map(([v, lbl]) =>
        `<option value="${v}"${val === v ? ' selected' : ''}>${lbl}</option>`
    ).join('');

    container.innerHTML = window.gkCurves.map((curve, idx) => `
        <div style="background:white;padding:10px 12px;border-radius:6px;margin-bottom:8px;
                    border:1px solid #ddd;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-weight:600;color:#6f42c1;min-width:40px;">GK ${idx + 1}</span>
            <label style="font-size:12px;">α&nbsp;[√Ω·cm]
                <input type="number" value="${curve.alpha}" step="1" min="0"
                    style="width:70px;padding:3px;border:1px solid #ddd;border-radius:4px;"
                    onchange="window.gkCurves[${idx}].alpha=parseFloat(this.value)||0; updateSpectralPlots();">
            </label>
            <label style="font-size:12px;">Rb&nbsp;[Ω·cm²]
                <input type="number" value="${curve.Rb}" step="1" min="0"
                    style="width:70px;padding:3px;border:1px solid #ddd;border-radius:4px;"
                    onchange="window.gkCurves[${idx}].Rb=parseFloat(this.value)||0; updateSpectralPlots();">
            </label>
            <label style="font-size:12px;">Cm&nbsp;[F/cm²]
                <input type="text" value="${curve.Cm.toExponential(2)}"
                    style="width:85px;padding:3px;border:1px solid #ddd;border-radius:4px;"
                    onchange="window.gkCurves[${idx}].Cm=parseFloat(this.value)||1e-6; updateSpectralPlots();">
            </label>
            <label style="font-size:12px;">ae&nbsp;[cm²]
                <input type="text" value="${curve.ae.toExponential(2)}"
                    style="width:75px;padding:3px;border:1px solid #ddd;border-radius:4px;"
                    onchange="window.gkCurves[${idx}].ae=parseFloat(this.value)||1e-4; updateSpectralPlots();">
            </label>
            <label style="font-size:12px;">Marker
                <select style="padding:3px 4px;border:1px solid #ddd;border-radius:4px;font-size:0.82em;"
                    onchange="window.gkCurves[${idx}].marker=this.value; updateSpectralPlots();">
                    ${_sel(_GK_MARKER_OPTIONS, curve.marker || 'none')}
                </select>
            </label>
            <label style="font-size:12px;">Line
                <select style="padding:3px 4px;border:1px solid #ddd;border-radius:4px;font-size:0.82em;"
                    onchange="window.gkCurves[${idx}].dash=this.value; updateSpectralPlots();">
                    ${_sel(_GK_DASH_OPTIONS, curve.dash || 'solid')}
                </select>
            </label>
            <input type="color" value="${curve.color}"
                style="width:28px;height:26px;border:none;cursor:pointer;padding:1px;border-radius:4px;"
                title="Curve color"
                onchange="window.gkCurves[${idx}].color=this.value; updateSpectralPlots();">
            <button onclick="removeGKCurve(${idx})"
                style="background:#dc3545;color:white;border:none;border-radius:4px;
                       padding:3px 8px;cursor:pointer;font-size:12px;">✕</button>
        </div>
    `).join('');
}
