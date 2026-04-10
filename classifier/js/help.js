// ============================================================
// ECIS CLASSIFIER v8 — Contextual Help System
// ============================================================
// Provides help modals for each filter section in the
// Simulation Selection panel and for GK model parameters.
//
// Usage:
//   openHelp('wh')          — opens help for Wound Healing type
//   openHelp('ran')         — opens help for Random Death type
//   openHelp('cld')         — opens help for Clustered Death type
//   openHelp('inf')         — opens help for Infection/Fusion type
//   openHelp('gkParams')    — opens GK parameter overview
//   openHelp('cellShapes')  — opens cell geometry help
//   openHelp('electrode')   — opens electrode profile help
//   closeHelp()             — closes the modal
//
// Images are loaded from images/help/*.{png,gif,webp}.
// If an image file is missing the placeholder SVG is shown.
// ============================================================

// ---------------------------------------------------------------------------
// SVG illustrations (inline, no file dependency)
// ---------------------------------------------------------------------------

const _SVG_HEX = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 155" width="200" height="155">
  <title>Hexagonal compact lattice — flat-top hexagons sharing full edges</title>
  <!-- 5 columns × 3 rows = 15 hexagons. R=22, inner=19, spacing_x=33, spacing_y=38.
       Even cols (0,2,4) at y=25,63,101; odd cols (1,3) at y=44,82,120.
       Adjacent cells share a full edge (verified: shared vertex pairs). -->
  <g fill="#e0f7fa" stroke="#006064" stroke-width="1.5">
    <!-- col 0 (cx=25) -->
    <polygon points="47,25 36,44 14,44 3,25 14,6 36,6"/>
    <polygon points="47,63 36,82 14,82 3,63 14,44 36,44"/>
    <polygon points="47,101 36,120 14,120 3,101 14,82 36,82"/>
    <!-- col 1 (cx=58) -->
    <polygon points="80,44 69,63 47,63 36,44 47,25 69,25"/>
    <polygon points="80,82 69,101 47,101 36,82 47,63 69,63"/>
    <polygon points="80,120 69,139 47,139 36,120 47,101 69,101"/>
    <!-- col 2 (cx=91) — top and bottom only; centre drawn separately -->
    <polygon points="113,25 102,44 80,44 69,25 80,6 102,6"/>
    <polygon points="113,101 102,120 80,120 69,101 80,82 102,82"/>
    <!-- col 3 (cx=124) -->
    <polygon points="146,44 135,63 113,63 102,44 113,25 135,25"/>
    <polygon points="146,82 135,101 113,101 102,82 113,63 135,63"/>
    <polygon points="146,120 135,139 113,139 102,120 113,101 135,101"/>
    <!-- col 4 (cx=157) -->
    <polygon points="179,25 168,44 146,44 135,25 146,6 168,6"/>
    <polygon points="179,63 168,82 146,82 135,63 146,44 168,44"/>
    <polygon points="179,101 168,120 146,120 135,101 146,82 168,82"/>
  </g>
  <!-- Highlighted centre cell (col 2, cy=63) -->
  <polygon points="113,63 102,82 80,82 69,63 80,44 102,44" fill="#4dd0e1" stroke="#006064" stroke-width="2"/>
  <text x="91" y="67" text-anchor="middle" font-size="8" fill="#004d40" font-weight="bold">Cell</text>
  <text x="100" y="151" text-anchor="middle" font-size="10" fill="#546e7a">Hexagonal compact lattice</text>
</svg>`;

const _SVG_REC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 174" width="200" height="174">
  <title>Rectangular cell packing</title>
  <g fill="#e3f2fd" stroke="#1565c0" stroke-width="1.5">
    <rect x="10"  y="10"  width="55" height="45"/>
    <rect x="65"  y="10"  width="55" height="45"/>
    <rect x="120" y="10"  width="55" height="45"/>
    <rect x="10"  y="55"  width="55" height="45" fill="#bbdefb"/>
    <rect x="65"  y="55"  width="55" height="45" fill="#bbdefb"/>
    <rect x="120" y="55"  width="55" height="45" fill="#bbdefb"/>
    <rect x="10"  y="100" width="55" height="45"/>
    <rect x="65"  y="100" width="55" height="45"/>
    <rect x="120" y="100" width="55" height="45"/>
  </g>
  <text x="100" y="160" text-anchor="middle" font-size="10" fill="#546e7a">Rectangular packing</text>
</svg>`;

const _SVG_TRI = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 125" width="200" height="125">
  <title>Triangular packing — even rows all ▽ (apex down), odd rows all ▲ (apex up)</title>
  <!-- Derived from TriCell source: spacing_x=w=28, spacing_y=3h=51, h=17.
       Center y: row*51 + (col+row)%2==1 ? 17 : 0, base y_offset=20.
       Even rows (row 0): all DOWN (▽). Odd rows (row 1): all UP (▲).
       Apex touching: (r=0,c=0) DOWN apex (30,54) == (r=1,c=0) UP apex (30,54). -->
  <g stroke="#5c6bc0" stroke-width="1.5">
    <!-- Row 0: all DOWN (▽) — base at top, apex pointing down -->
    <polygon points="2,3   58,3   30,54"  fill="#e8eaf6"/>
    <polygon points="30,20  86,20  58,71"  fill="#e8eaf6"/>
    <polygon points="58,3  114,3   86,54"  fill="#e8eaf6"/>
    <polygon points="86,20 142,20 114,71"  fill="#e8eaf6"/>
    <polygon points="114,3 170,3  142,54"  fill="#e8eaf6"/>
    <polygon points="142,20 198,20 170,71" fill="#e8eaf6"/>
    <!-- Row 1: all UP (▲) — base at bottom, apex pointing up toward row 0 apexes -->
    <polygon points="2,105  58,105  30,54"  fill="#fce4ec"/>
    <polygon points="30,88  86,88   58,37"  fill="#fce4ec"/>
    <polygon points="58,105 114,105  86,54"  fill="#fce4ec"/>
    <polygon points="86,88  142,88  114,37"  fill="#fce4ec"/>
    <polygon points="114,105 170,105 142,54"  fill="#fce4ec"/>
    <polygon points="142,88  198,88  170,37"  fill="#fce4ec"/>
  </g>
  <!-- Apex-to-apex contact markers (points facing each other) -->
  <circle cx="30"  cy="54" r="2.5" fill="#5c6bc0"/>
  <circle cx="86"  cy="54" r="2.5" fill="#5c6bc0"/>
  <circle cx="142" cy="54" r="2.5" fill="#5c6bc0"/>
  <text x="100" y="120" text-anchor="middle" font-size="10" fill="#546e7a">Triangular packing (▽ rows / ▲ rows)</text>
</svg>`;

const _SVG_WH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <title>Wound Healing stages</title>
  <!-- Electrode circle -->
  <circle cx="100" cy="100" r="90" fill="#e8f5e9" stroke="#4caf50" stroke-width="2"/>
  <!-- Confluent cells (outer ring) -->
  <circle cx="100" cy="100" r="90" fill="#c8e6c9" stroke="none"/>
  <!-- Stage 0: large wound (empty centre) -->
  <circle cx="100" cy="100" r="55" fill="white" stroke="#ff7043" stroke-width="2" stroke-dasharray="6,3"/>
  <!-- Stage 3: partially healed -->
  <circle cx="100" cy="100" r="35" fill="white" stroke="#ffa726" stroke-width="1.5" stroke-dasharray="4,3"/>
  <!-- Stage 7: nearly healed -->
  <circle cx="100" cy="100" r="18" fill="white" stroke="#66bb6a" stroke-width="1.5" stroke-dasharray="3,3"/>
  <!-- Stage 11: confluent -->
  <circle cx="100" cy="100" r="6" fill="#a5d6a7" stroke="#43a047" stroke-width="1"/>
  <!-- Arrow indicating healing direction -->
  <path d="M 155 100 Q 130 75 108 85" stroke="#37474f" stroke-width="1.5" fill="none" marker-end="url(#arr)"/>
  <defs>
    <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="#37474f"/>
    </marker>
  </defs>
  <!-- Stage labels (step 0 = smallest wound, step 10 = largest) -->
  <text x="143" y="68" font-size="9" fill="#e64a19">step 10</text>
  <text x="143" y="108" font-size="9" fill="#ef6c00">step 5</text>
  <text x="120" y="138" font-size="9" fill="#388e3c">step 1</text>
  <text x="100" y="167" text-anchor="middle" font-size="10" fill="#546e7a">Wound radius increases with step</text>
</svg>`;

const _SVG_RAN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <title>Random cell death</title>
  <!-- Electrode -->
  <circle cx="100" cy="100" r="88" fill="#f3e5f5" stroke="#7b1fa2" stroke-width="2"/>
  <!-- Hex grid background -->
  <g fill="#e1bee7" stroke="#7b1fa2" stroke-width="0.8" opacity="0.5">
    <polygon points="100,15 116,24 116,42 100,51 84,42 84,24"/>
    <polygon points="132,32 148,41 148,59 132,68 116,59 116,41"/>
    <polygon points="68,32 84,41 84,59 68,68 52,59 52,41"/>
    <polygon points="164,49 180,58 180,76 164,85 148,76 148,58"/>
    <polygon points="36,49 52,58 52,76 36,85 20,76 20,58"/>
    <polygon points="100,66 116,75 116,93 100,102 84,93 84,75"/>
    <polygon points="132,83 148,92 148,110 132,119 116,110 116,92"/>
    <polygon points="68,83 84,92 84,110 68,119 52,110 52,92"/>
    <polygon points="100,117 116,126 116,144 100,153 84,144 84,126"/>
    <polygon points="132,134 148,143 148,161 132,170 116,161 116,143"/>
    <polygon points="68,134 84,143 84,161 68,170 52,161 52,143"/>
    <polygon points="164,100 180,109 180,127 164,136 148,127 148,109"/>
    <polygon points="36,100 52,109 52,127 36,136 20,127 20,109"/>
    <polygon points="164,151 180,160 180,178 164,187 148,178 148,160"/>
    <polygon points="36,151 52,160 52,178 36,187 20,178 20,160"/>
  </g>
  <!-- Dead cells (white / empty) — randomly distributed -->
  <polygon points="132,32 148,41 148,59 132,68 116,59 116,41" fill="white" stroke="#bdbdbd" stroke-width="1" opacity="0.9"/>
  <polygon points="100,66 116,75 116,93 100,102 84,93 84,75"  fill="white" stroke="#bdbdbd" stroke-width="1" opacity="0.9"/>
  <polygon points="68,134 84,143 84,161 68,170 52,161 52,143" fill="white" stroke="#bdbdbd" stroke-width="1" opacity="0.9"/>
  <polygon points="164,100 180,109 180,127 164,136 148,127 148,109" fill="white" stroke="#bdbdbd" stroke-width="1" opacity="0.9"/>
  <polygon points="100,117 116,126 116,144 100,153 84,144 84,126" fill="white" stroke="#bdbdbd" stroke-width="1" opacity="0.9"/>
  <!-- Dead cell markers (×) -->
  <text x="132" y="54" text-anchor="middle" font-size="14" fill="#ef9a9a">✕</text>
  <text x="100" y="88" text-anchor="middle" font-size="14" fill="#ef9a9a">✕</text>
  <text x="68"  y="156" text-anchor="middle" font-size="14" fill="#ef9a9a">✕</text>
  <text x="100" y="139" text-anchor="middle" font-size="14" fill="#ef9a9a">✕</text>
  <text x="100" y="180" text-anchor="middle" font-size="10" fill="#546e7a">~30% cells dead</text>
</svg>`;

const _SVG_INF = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <title>Infected / fused cells — non-central seed cluster (lower-left)</title>
  <!-- Electrode -->
  <circle cx="100" cy="100" r="88" fill="#fff3e0" stroke="#e65100" stroke-width="2"/>
  <!-- Background: all living cells -->
  <g fill="#ffe0b2" stroke="#e65100" stroke-width="0.8" opacity="0.5">
    <polygon points="100,15 116,24 116,42 100,51 84,42 84,24"/>
    <polygon points="132,32 148,41 148,59 132,68 116,59 116,41"/>
    <polygon points="164,49 180,58 180,76 164,85 148,76 148,58"/>
    <polygon points="100,66 116,75 116,93 100,102 84,93 84,75"/>
    <polygon points="132,83 148,92 148,110 132,119 116,110 116,92"/>
    <polygon points="100,117 116,126 116,144 100,153 84,144 84,126"/>
    <polygon points="132,134 148,143 148,161 132,170 116,161 116,143"/>
    <polygon points="164,100 180,109 180,127 164,136 148,127 148,109"/>
    <polygon points="164,151 180,160 180,178 164,187 148,178 148,160"/>
    <polygon points="36,151 52,160 52,178 36,187 20,178 20,160"/>
  </g>
  <!-- Fused seed cluster: 3 cells in lower-left (not centred) -->
  <polygon points="68,83 84,92 84,110 68,119 52,110 52,92"   fill="#ff8f00" stroke="#e65100" stroke-width="1.5" opacity="0.9"/>
  <polygon points="36,100 52,109 52,127 36,136 20,127 20,109" fill="#ff8f00" stroke="#e65100" stroke-width="1.5" opacity="0.9"/>
  <polygon points="68,134 84,143 84,161 68,170 52,161 52,143" fill="#ff8f00" stroke="#e65100" stroke-width="1.5" opacity="0.9"/>
  <!-- Step-1 cell being fused (dashed border) -->
  <polygon points="36,49 52,58 52,76 36,85 20,76 20,58" fill="#ffcc02" stroke="#e65100" stroke-width="1.2" stroke-dasharray="3,2" opacity="0.85"/>
  <!-- Labels -->
  <text x="58" y="113" text-anchor="middle" font-size="8" fill="white" font-weight="bold">FUSED</text>
  <text x="46" y="96"  text-anchor="middle" font-size="13" fill="#bf360c">⚠</text>
  <!-- Arrow: cluster propagates outward via Von Neumann neighbours -->
  <defs>
    <marker id="inf-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="#e65100"/>
    </marker>
  </defs>
  <path d="M 84 96 Q 106 90 122 84" stroke="#e65100" stroke-width="1.5" fill="none"
        marker-end="url(#inf-arr)" stroke-dasharray="4,2"/>
  <text x="100" y="185" text-anchor="middle" font-size="10" fill="#546e7a">Infected cells fuse membranes</text>
</svg>`;

const _SVG_CLD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <title>Clustered cell death — non-central seed (upper-right), Von Neumann propagation</title>
  <!-- Electrode -->
  <circle cx="100" cy="100" r="88" fill="#f3e5f5" stroke="#7b1fa2" stroke-width="2"/>
  <!-- Background: all living cells -->
  <g fill="#e1bee7" stroke="#7b1fa2" stroke-width="0.8" opacity="0.5">
    <polygon points="68,32 84,41 84,59 68,68 52,59 52,41"/>
    <polygon points="36,49 52,58 52,76 36,85 20,76 20,58"/>
    <polygon points="100,66 116,75 116,93 100,102 84,93 84,75"/>
    <polygon points="68,83 84,92 84,110 68,119 52,110 52,92"/>
    <polygon points="100,117 116,126 116,144 100,153 84,144 84,126"/>
    <polygon points="68,134 84,143 84,161 68,170 52,161 52,143"/>
    <polygon points="36,100 52,109 52,127 36,136 20,127 20,109"/>
    <polygon points="36,151 52,160 52,178 36,187 20,178 20,160"/>
    <polygon points="132,134 148,143 148,161 132,170 116,161 116,143"/>
    <polygon points="164,151 180,160 180,178 164,187 148,178 148,160"/>
  </g>
  <!-- Dead seed cluster: 3 cells in upper-right (not centred) -->
  <polygon points="132,32 148,41 148,59 132,68 116,59 116,41"  fill="white" stroke="#9e9e9e" stroke-width="1.2" opacity="0.95"/>
  <polygon points="164,49 180,58 180,76 164,85 148,76 148,58"   fill="white" stroke="#9e9e9e" stroke-width="1.2" opacity="0.95"/>
  <polygon points="132,83 148,92 148,110 132,119 116,110 116,92" fill="white" stroke="#9e9e9e" stroke-width="1.2" opacity="0.95"/>
  <text x="132" y="54"  text-anchor="middle" font-size="13" fill="#ef9a9a">✕</text>
  <text x="164" y="71"  text-anchor="middle" font-size="13" fill="#ef9a9a">✕</text>
  <text x="132" y="105" text-anchor="middle" font-size="13" fill="#ef9a9a">✕</text>
  <!-- Step-1 extension (Von Neumann neighbours, dashed) -->
  <polygon points="100,15 116,24 116,42 100,51 84,42 84,24"     fill="#fafafa" stroke="#bdbdbd" stroke-width="1" stroke-dasharray="3,2" opacity="0.9"/>
  <polygon points="164,100 180,109 180,127 164,136 148,127 148,109" fill="#fafafa" stroke="#bdbdbd" stroke-width="1" stroke-dasharray="3,2" opacity="0.9"/>
  <!-- Arrow showing outward propagation -->
  <defs>
    <marker id="cld-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="#757575"/>
    </marker>
  </defs>
  <path d="M 125 119 Q 112 138 100 152" stroke="#757575" stroke-width="1.5" fill="none"
        marker-end="url(#cld-arr)" stroke-dasharray="4,2"/>
  <text x="100" y="185" text-anchor="middle" font-size="9" fill="#546e7a">seed 3 cells → grows outward (Von Neumann)</text>
</svg>`;

const _SVG_ELECTRODE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 160" width="200" height="160">
  <title>CPE electrode model</title>
  <!-- Electrode circle -->
  <circle cx="100" cy="70" r="50" fill="#e3f2fd" stroke="#1565c0" stroke-width="2"/>
  <text x="100" y="65" text-anchor="middle" font-size="10" fill="#1565c0">Electrode</text>
  <text x="100" y="78" text-anchor="middle" font-size="9"  fill="#1565c0">Ø = de µm</text>
  <!-- CPE element below -->
  <line x1="100" y1="120" x2="100" y2="140" stroke="#546e7a" stroke-width="1.5"/>
  <rect x="75" y="104" width="50" height="18" fill="#fff9c4" stroke="#f9a825" stroke-width="1.5" rx="3"/>
  <text x="100" y="117" text-anchor="middle" font-size="9" fill="#e65100" font-weight="bold">CPE</text>
  <line x1="100" y1="120" x2="100" y2="122" stroke="#546e7a" stroke-width="1.5"/>
  <!-- Dimension arrows -->
  <defs>
    <marker id="dim" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
      <path d="M0,0 L5,2.5 L0,5 Z" fill="#546e7a"/>
    </marker>
    <marker id="diml" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto-start-reverse">
      <path d="M0,0 L5,2.5 L0,5 Z" fill="#546e7a"/>
    </marker>
  </defs>
  <line x1="50" y1="145" x2="150" y2="145" stroke="#546e7a" stroke-width="1"
        marker-start="url(#diml)" marker-end="url(#dim)"/>
  <text x="100" y="157" text-anchor="middle" font-size="9" fill="#546e7a">diameter = de</text>
</svg>`;

// ---------------------------------------------------------------------------
// Help content definitions
// ---------------------------------------------------------------------------

const HELP_CONTENT = {

    // ── Simulation types ────────────────────────────────────────────────────

    wh: {
        title: 'Electrical Wound Healing (WH)',
        imageFile: 'images/help/wh_culture.gif',
        imageFallback: _SVG_WH,
        imageCaption: 'Wound radius increases with step. Step 0: only the central cell is dead. Higher steps correspond to larger wound radii.',
        html: `
<h4>What it represents</h4>
<p>During the assay, an invasive current at high frequency is passed through the electrodes,
killing the cells directly above them and leaving a well-defined circular wound. Over time,
cells at the wound edge migrate inward, progressively closing the gap. This is modelled
as a discrete set of wound sizes.</p>

<h4>Step parameter</h4>
<p>The <code>step</code> value encodes the wound size:</p>
<table class="help-param-table">
  <tr><th>Step</th><th>Meaning</th></tr>
  <tr><td>-1</td><td>Confluent baseline — no wound, full coverage</td></tr>
  <tr><td>0</td><td>Smallest wound — only the central cell of the electrode is dead</td></tr>
  <tr><td>1–10</td><td>Progressively larger wound — dead zone radius increases with each step</td></tr>
</table>

<h4>Impedance signature</h4>
<p>The wound area contains no cells, so the electrode is partially uncovered.
This reduces impedance magnitude, with the effect proportional to the wound radius.
As the wound heals (step decreases), impedance recovers toward the confluent baseline.</p>`
    },

    ran: {
        title: 'Random Cell Death (RAN)',
        imageFile: 'images/help/ran_spectra.png',
        imageFallback: _SVG_RAN,
        imageCaption: 'Spectral evolution with increasing dead fraction. Each curve corresponds to a different percentage of detached cells.',
        html: `
<h4>What it represents</h4>
<p>A fraction of cells die and detach from the electrode, leaving empty spaces randomly distributed
across the monolayer. Unlike clustered death, the empty spaces are
<strong>not spatially correlated</strong>.</p>

<h4>Percentage parameter</h4>
<p><code>percentage</code> = fraction of dead cells (0 to 1):</p>
<table class="help-param-table">
  <tr><th>Value</th><th>Meaning</th></tr>
  <tr><td>0.0</td><td>All cells alive (confluent baseline)</td></tr>
  <tr><td>0.5</td><td>50% of cells have detached</td></tr>
  <tr><td>1.0</td><td>All cells dead — bare electrode</td></tr>
</table>
<p>There is no <code>step</code> parameter for this simulation type.</p>

<h4>Impedance signature</h4>
<p>Increasing the dead fraction progressively modifies the spectrum, transitioning from the
confluent signature toward the bare electrode response. The spectral plots show
how impedance magnitude and phase evolve across the full percentage range.</p>`
    },

    inf: {
        title: 'Infected / Fused Cells (INF)',
        imageFile: 'images/help/inf_culture.gif',
        imageFallback: _SVG_INF,
        imageCaption: 'Infection propagation over time. At each step, edge-sharing (Von Neumann) neighbours of infected cells become infected.',
        html: `
<h4>What it represents</h4>
<p>A fraction of cells become infected and their membranes fuse with adjacent cells,
creating clusters with modified barrier properties. The <code>step</code> parameter encodes
the infection propagation: at each time step, the <strong>Von Neumann first neighbours</strong>
(cells sharing an edge — N/S/E/W for rectangular, or the 3 edge-sharing cells for other shapes)
of infected cells become fused. Diagonal contacts do <em>not</em> propagate infection.</p>

<h4>Parameters</h4>
<table class="help-param-table">
  <tr><th>Parameter</th><th>Meaning</th></tr>
  <tr><td><code>step</code></td><td>Discrete time step of infection propagation (0 to ~12). Higher step = more cells fused.</td></tr>
  <tr><td><code>percentage</code></td><td>Initial seed fraction — the fraction of cells infected at step 0, from which propagation begins.</td></tr>
</table>

<h4>Impedance signature</h4>
<p>Membrane fusion disrupts tight junctions, removing resistive paracellular pathways.
The net effect on the spectrum depends on the extent of fusion and the spatial distribution
of the infected cluster.</p>`
    },

    cld: {
        title: 'Clustered Cell Death (CLD)',
        imageFile: 'images/help/cld_culture.gif',
        imageFallback: _SVG_CLD,
        imageCaption: 'Death propagates from an initial seed outward to Von Neumann (edge-sharing) neighbours at each step.',
        html: `
<h4>What it represents</h4>
<p>A cluster of cells dies in a spatially propagating pattern: an initial fraction of cells
(the seed) die first, and at each subsequent time step their <strong>Von Neumann first neighbours</strong>
(edge-sharing cells only — diagonals do not propagate) also die,
creating a growing clustered wound in the monolayer.</p>

<h4>Parameters</h4>
<table class="help-param-table">
  <tr><th>Parameter</th><th>Meaning</th></tr>
  <tr><td><code>step</code></td><td>Discrete propagation step (0 to ~13). Step 0 = only the seed cells are dead; each additional step kills the next ring of neighbours.</td></tr>
  <tr><td><code>percentage</code></td><td>Initial seed fraction — the fraction of cells that die at step 0.</td></tr>
</table>

<h4>Impedance signature</h4>
<p>As the dead cluster grows, the electrode becomes progressively uncovered in a spatially
coherent patch. The impedance decreases with increasing step, transitioning from the confluent
response toward a partially bare electrode spectrum.</p>`
    },

    cov: {
        title: 'Confluent Monolayer (COV)',
        imageFile: 'images/help/confluent.png',
        imageFallback: _SVG_HEX,
        imageCaption: 'Complete cell monolayer with full electrode coverage.',
        html: `
<h4>What it represents</h4>
<p>A fully confluent, unperturbed cell monolayer covering the electrode. All cells are alive,
tightly packed, with intact tight junctions. This is the <strong>baseline state</strong>
from which other conditions deviate.</p>

<h4>Impedance signature</h4>
<p>Confluent impedance shows the characteristic three-regime ECIS spectrum:</p>
<ul>
  <li><strong>Low frequency (~100 Hz–2 kHz)</strong>: dominated by Rb (tight junction resistance) — high impedance plateau</li>
  <li><strong>Mid frequency (~2–20 kHz)</strong>: transition region sensitive to α (cell-substrate coupling)</li>
  <li><strong>High frequency (&gt;20 kHz)</strong>: dominated by Cm (membrane capacitance) — impedance decreases as 1/ωCm</li>
</ul>

<h4>Biological context</h4>
<p>Reference state for all ECIS experiments. Used to verify cell health, measure GK model
parameters (α, Rb, Cm) at confluency, and as comparison baseline for perturbation experiments.</p>`
    },

    // ── Cell geometry ────────────────────────────────────────────────────────

    cellShapes: {
        title: 'Cell Geometry — Shape & H/W Ratio',
        imageFile: null,
        imageFallback: `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;align-items:flex-end;">
            <figure style="margin:0;text-align:center">
              ${_SVG_HEX}
              <figcaption style="font-size:10px;color:#546e7a">Hexagonal</figcaption>
            </figure>
            <figure style="margin:0;text-align:center">
              ${_SVG_REC}
              <figcaption style="font-size:10px;color:#546e7a">Rectangular</figcaption>
            </figure>
            <figure style="margin:0;text-align:center">
              ${_SVG_TRI}
              <figcaption style="font-size:10px;color:#546e7a">Triangular</figcaption>
            </figure></div>`,
        imageCaption: 'Three cell packing geometries supported by the simulator.',
        html: `
<h4>Cell Shape</h4>
<p>The simulator tessellates the finite-difference grid using one of three cell geometries.
All three can be combined in a single library for broader fitting.</p>
<table class="help-param-table">
  <tr><th>Shape</th><th>Neighbours</th><th>Description</th></tr>
  <tr><td><strong>Hexagonal (hex)</strong></td><td>6</td><td>Pointy-top hexagonal tiling. Minimises perimeter-to-area ratio. Each cell shares an edge with 6 others.</td></tr>
  <tr><td><strong>Rectangular (rec)</strong></td><td>4 <em>(Von Neumann)</em></td><td>Square cells sharing edges with the 4 orthogonal neighbours (N/S/E/W only — diagonal contacts are not connected). Good approximation for epithelial cells on flat substrates.</td></tr>
  <tr><td><strong>Triangular (tri)</strong></td><td>3</td><td>Checkerboard of ▲ (upward) and ▽ (downward) cells alternating within each row. Each triangle shares an edge with 3 neighbours.</td></tr>
</table>
<p><strong>Note on neighbourhood type</strong>: rectangular cells use a <em>Von Neumann</em> neighbourhood (4 orthogonal contacts). This means infection/death propagation steps travel only through shared edges, not through diagonal contacts. Moore neighbourhood (8 contacts including diagonals) is <strong>not</strong> used.</p>

<h4>H/W Ratio (Height-to-Width)</h4>
<p>Scales the cell shape anisotropically along one axis:</p>
<table class="help-param-table">
  <tr><th>H/W value</th><th>Interpretation</th></tr>
  <tr><td>1.0</td><td>Isotropic cell footprint</td></tr>
  <tr><td>&gt;1.0</td><td>Elongated along vertical axis</td></tr>
  <tr><td>&lt;1.0</td><td>Wider than tall</td></tr>
</table>
<p>The vast majority of simulations in this library use <code>H/W = 1.0</code>
(isotropic rectangular cells, <code>rec</code> shape). Select <code>1.00</code> for most fits.</p>`
    },

    // ── Electrode profile ────────────────────────────────────────────────────

    electrode: {
        title: 'Electrode Profile (CPE)',
        imageFile: null,
        imageFallback: _SVG_ELECTRODE,
        imageCaption: 'Electrode modelled as a circular disk with CPE polarisation impedance.',
        html: `
<h4>What is the electrode profile?</h4>
<p>The electrode geometry and its electrical properties are fixed per simulation. Each
"electrode profile" card combines three parameters that fully characterise the bare-electrode
impedance contribution:</p>
<table class="help-param-table">
  <tr><th>Parameter</th><th>Symbol</th><th>Units</th><th>Meaning</th></tr>
  <tr><td>Diameter</td><td>de</td><td>µm</td><td>Physical electrode diameter. Larger electrode → lower bare impedance.</td></tr>
  <tr><td>CPE amplitude</td><td>A<sub>CPE</sub></td><td>Ω⁻¹·sⁿ</td><td>Scales the electrode polarisation. Higher A → lower electrode impedance at all frequencies.</td></tr>
  <tr><td>CPE exponent</td><td>n<sub>CPE</sub></td><td>—</td><td>Frequency dispersion exponent. n=1 → ideal capacitor; n&lt;1 → rough/porous electrode surface (typical range 0.8–1.0).</td></tr>
</table>

<h4>CPE model</h4>
<p>The bare electrode impedance is modelled as a Constant Phase Element:</p>
<p style="font-family:monospace;background:#f5f5f5;padding:6px 10px;border-radius:4px;font-size:12px;">
  Z<sub>electrode</sub> = 1 / [A<sub>CPE</sub> · (j·2π·f)<sup>n</sup>]
</p>
<p>This is subtracted from the measured spectrum before fitting.
<strong>Select the profile matching your experimental electrode</strong> to ensure the
subtraction is physically correct.</p>

<h4>Constriction resistance (R_constr)</h4>
<p>Each simulation also has an R_constr value derived from the electrode geometry
(resistance of the narrow gap between electrode edge and substrate). This is shown in
Classification results and can be overridden if measured independently.</p>`
    },

    // ── GK parameters ────────────────────────────────────────────────────────

    gkParams: {
        title: 'GK Model Parameters (α, Rb, Cm, Ac)',
        imageFile: 'images/help/gk_model.png',
        imageFallback: null,
        imageCaption: 'Giaever–Keese (GK) model: cell on electrode with current paths through and around each cell.',
        html: `
<h4>The Giaever-Keese (GK) Model</h4>
<p>The GK model describes how a cell monolayer modifies electrode impedance through three
independent current pathways: under the cell body (through the cell-substrate gap), through
tight junctions between cells, and through the cell membrane itself.</p>

<table class="help-param-table">
  <tr>
    <th>Parameter</th><th>Symbol</th><th>Units</th><th>Physical meaning</th><th>Typical range</th>
  </tr>
  <tr>
    <td><strong>Cell Area</strong></td>
    <td>Ac</td>
    <td>µm²</td>
    <td>Projected footprint area of one cell on the substrate. Determines how many cells fit on the electrode and the fraction of electrode covered.</td>
    <td>100–5000 µm²</td>
  </tr>
  <tr>
    <td><strong>Alpha (α)</strong></td>
    <td>α</td>
    <td>√Ω·cm</td>
    <td>Resistance of the cell-substrate gap (ventral cleft). Defined as α = rc·√(ρ/h), where rc is the cell radius, ρ is the medium resistivity, and h is the gap height. Higher α → stronger resistance elevation at low-to-mid frequencies.</td>
    <td>5–100 √Ω·cm</td>
  </tr>
  <tr>
    <td><strong>Tight Junction Resistance</strong></td>
    <td>Rb</td>
    <td>Ω·cm²</td>
    <td>Paracellular resistance at tight junctions between adjacent cells. The primary determinant of the low-frequency impedance plateau. Higher Rb → tighter monolayer.</td>
    <td>5–500 Ω·cm²</td>
  </tr>
  <tr>
    <td><strong>Membrane Capacitance</strong></td>
    <td>Cm</td>
    <td>F/cm²</td>
    <td>Specific capacitance of the cell membrane (dorsal + ventral). Determines the characteristic frequency above which current bypasses the cell body through its capacitance. Higher Cm shifts this frequency upward.</td>
    <td>0.5–5 µF/cm²</td>
  </tr>
</table>

<h4>Classification strategy</h4>
<p>The classifier finds the (Ac, α, Rb, Cm) combination that minimises the spectral distance
between the experimental measurement and the simulated library. The groupby optimisation
first finds the best parameter group, then ranks all simulation states within that group,
for the whole evolution of that culture. Multi-stage classification allows separation of the
evolution into independent groups, useful for drug delivery or confluent-only classification.</p>`
    },
};

// ---------------------------------------------------------------------------
// Modal control
// ---------------------------------------------------------------------------

/**
 * Open the help modal for the given content key.
 * @param {string} key  One of: 'wh', 'ran', 'inf', 'rup', 'cov',
 *                      'cellShapes', 'electrode', 'gkParams'
 */
function openHelp(key) {
    const content = HELP_CONTENT[key];
    if (!content) { console.warn('openHelp: unknown key', key); return; }

    const overlay = document.getElementById('helpModalOverlay');
    if (!overlay) return;

    // Title
    overlay.querySelector('.help-modal-title').textContent = content.title;

    // Image column
    const imgCol = overlay.querySelector('.help-modal-image-col');
    imgCol.innerHTML = '';

    if (content.imageFile) {
        // Try loading the image file; fallback to inline SVG on error
        const img = document.createElement('img');
        img.src = content.imageFile;
        img.alt = content.title;
        img.onerror = () => {
            imgCol.innerHTML = '';
            _insertFallback(imgCol, content);
        };
        imgCol.appendChild(img);
    } else if (content.imageFallback) {
        _insertFallback(imgCol, content);
    } else {
        // No image at all — placeholder
        imgCol.innerHTML = `<div class="help-modal-image-placeholder">
            <span style="font-size:24px;">🔬</span>
            <span>Image coming soon</span></div>`;
    }

    if (content.imageCaption) {
        const cap = document.createElement('div');
        cap.className = 'help-modal-image-caption';
        cap.textContent = content.imageCaption;
        imgCol.appendChild(cap);
    }

    // Text column
    overlay.querySelector('.help-modal-text-col').innerHTML = content.html;

    // Footer reference
    const footer = overlay.querySelector('.help-modal-footer');
    footer.innerHTML = `
        <span class="help-ref-stub">📄 Reference: Manuscript in preparation (GK model — Giaever &amp; Keese, 1993)</span>
        <button class="button" style="margin-left:auto;padding:4px 14px;" onclick="closeHelp()">Close</button>`;

    overlay.classList.add('active');

    // Close on backdrop click
    overlay._closeOnClick = (e) => { if (e.target === overlay) closeHelp(); };
    overlay.addEventListener('click', overlay._closeOnClick);

    // Close on Escape
    overlay._escHandler = (e) => { if (e.key === 'Escape') closeHelp(); };
    document.addEventListener('keydown', overlay._escHandler);

    // Save triggering element for focus restore
    overlay._triggerElement = document.activeElement;

    // Move focus to first focusable element inside modal
    setTimeout(() => {
        const focusable = overlay.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length) focusable[0].focus();
    }, 50);

    // Focus trap
    overlay._trapHandler = (e) => {
        if (e.key !== 'Tab') return;
        const focusable = Array.from(overlay.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )).filter(el => !el.disabled && el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last  = focusable[focusable.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
            if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
        }
    };
    document.addEventListener('keydown', overlay._trapHandler);
}

function _insertFallback(col, content) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = content.imageFallback;
    col.appendChild(wrapper);
}

/** Close the help modal. */
function closeHelp() {
    const overlay = document.getElementById('helpModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    if (overlay._closeOnClick) { overlay.removeEventListener('click', overlay._closeOnClick); delete overlay._closeOnClick; }
    if (overlay._escHandler)   { document.removeEventListener('keydown', overlay._escHandler); delete overlay._escHandler; }
    if (overlay._trapHandler) {
        document.removeEventListener('keydown', overlay._trapHandler);
        delete overlay._trapHandler;
    }
    if (overlay._triggerElement) {
        overlay._triggerElement.focus();
        delete overlay._triggerElement;
    }
}
