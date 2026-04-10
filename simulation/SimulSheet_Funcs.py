import os
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from matplotlib.patches import Circle, Rectangle
import matplotlib.colors as mcolors
from CPE_GK_Funs import Z_CPE_B, GKSpectre
from ConstantsFile import SystemConst
from matplotlib.colors import ListedColormap, BoundaryNorm
from scipy import ndimage

# ============================================================================
# MAIN PLOTTING FUNCTIONS
# ============================================================================


def Pot_colormap(ax, Pot, f_plot, de, l, lado, colormap='Paired'):
    m = int(np.sqrt(len(Pot)))
    matrix = np.abs(Pot).reshape(m, m)
    
    # Color setup
    base_colors = list(plt.get_cmap(colormap, 12).colors)
    extra_color = (0.97, 0.97, 0.97)  # Light gray
    cmap = ListedColormap(base_colors + [extra_color])
    
    # Voltage bounds (0 to 1V normalized)
    bounds = np.array([-.1, 0.0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1.01, 1.1])
    norm = BoundaryNorm(bounds, cmap.N)
    
    # Calculate extent once (in µm)
    extent_um = 10e3 * l * lado / 2
    extent = [-extent_um, extent_um, -extent_um, extent_um]
    
    # Plot
    matrix = ndimage.rotate(matrix, 90, reshape=True)
    im = ax.imshow(np.rot90(matrix, k=3), cmap=cmap, norm=norm, 
                   origin='upper', extent=extent)

    # Electrode boundary
    circle = Circle((0, 0), 10e3*de/2, linestyle='--', color='black', 
                   fill=False, linewidth=2, clip_on=False)
    ax.add_patch(circle)
    ax.set_title(f'Voltage colormap at {f_plot:0.1f} Hz')
    
    # --- Custom ticks ---
    ticks = 10e3*l*np.arange(-lado/2,lado/2+1)
    
    labels = np.array([f"{tick:.2f}" for tick in ticks])
    if len(ticks) % 2 == 1:
        for i in range(1, int(len(ticks)/2), 2):
            labels[i] = ""
            labels[len(ticks)-1-i] = ""
    else:
        for i in range(1, int(len(ticks)/2 - 1), 2):
            labels[i] = ""
            labels[len(ticks)-1-i] = ""

    ax.set_xticks(ticks); ax.set_xticklabels(labels, rotation=-90)
    ax.set_yticks(ticks); ax.set_yticklabels(labels)
    ax.set_xlabel(r'Position [$\mu$m]', fontsize=12)
    ax.set_ylabel(r'Position [$\mu$m]', fontsize=12)
    ax.grid(visible=True, which='both', color='white', linestyle=":")

    # --- Colorbar ---
    cbar = plt.colorbar(im, ax=ax, fraction=0.05, pad=0.01, boundaries=bounds, ticks=np.linspace(bounds[0], bounds[-1], len(bounds)))
    cbar.ax.set_title('Voltage [V]')
    return

def Map_Electrode(ax, vector, de: float, l: float, n:int, lado: int):
    state_labels = {
        0: 'No Cell - Insulator',
        0.5: 'Cell - Insulator',
        1: 'No Cell - Electrode',
        1.5: 'Cell - Electrode',
        4: 'Tight junction',
    }
    state_colors = {
        0.0: '#9edae5',   # Light blue
        0.5: '#1f77b4',   # Dark blue
        1.0: '#ff9896',   # Light red
        1.5: '#ff7f0e',   # Orange
        4.0: '#737373',   # Gray
        5.0: '#737373'    # Gray (redundant, but kept for compatibility)
    }
    # Reshape and plot
    side = lado*(n+1) + 1
    matrix = vector.reshape(side, side)
    
    # Colormap setup
    cmap = mcolors.ListedColormap([state_colors[k] for k in sorted(state_colors.keys())])
    norm = mcolors.BoundaryNorm(boundaries=[-0.25, 0.25, 0.75, 1.25, 1.75, 4.5], ncolors=5)
    
    # Calculate extent (in µm)
    extent_um = 10e3 * lado * l / 2
    extent = [-extent_um, extent_um, -extent_um, extent_um]
    
    im = ax.imshow(matrix, cmap=cmap, norm=norm, origin='upper', extent=extent)
    
    # Build legend
    legend_elements = [Patch(facecolor=state_colors[k], label=v) 
                      for k, v in state_labels.items()]
    
    # Add electrode circle
    if de != 0:
        circle = Circle((0, 0), 10e3*de/2, linestyle='--', color='black', 
                       fill=False, linewidth=2, label='Electrode')
        ax.add_patch(circle)
        legend_elements.append(circle)
    
    # Add cell boundary rectangle
    cell_extent = 10e3 * l / 2
    rec = Rectangle((-cell_extent, -cell_extent), 10e3*l, 10e3*l, 
                   linestyle='-', color='black', fill=False, linewidth=2, label='Cell')
    ax.add_patch(rec)
    legend_elements.append(rec)
    
    # Axis ticks and labels
    ticks = 10e3 * l * np.arange(-lado/2, lado/2 + 1)
    labels = np.array([f"{tick:.1f}" for tick in ticks])
    
    if len(ticks) % 2 == 1:
        for i in range(1, int(len(ticks)/2), 2):
            labels[i] = ""
            labels[len(ticks)-1-i] = ""
    else:
        for i in range(1, int(len(ticks)/2 - 1), 2):
            labels[i] = ""
            labels[len(ticks)-1-i] = ""

    ax.set_xticks(ticks)
    ax.set_xticklabels(labels, rotation=-90)
    ax.set_yticks(ticks)
    ax.set_yticklabels(labels)

    ax.set_xlabel(r'Position [$\mu$m]', fontsize=11)
    ax.set_ylabel(r'Position [$\mu$m]', fontsize=11)

    ax.set_xlim(-10e3*lado*l/2, 10e3*lado*l/2)
    ax.set_ylim(-10e3*lado*l/2, 10e3*lado*l/2)

    ax.grid(visible=True, which='both', color='white', linestyle=":")
    
    ax.legend(handles=legend_elements, bbox_to_anchor=(0.5, 1.01), 
             loc='lower center', ncol=3, frameon=True)
    return

def ResultPlotting(fig, ax2, ax3, ax4, ax5, f, ae, Z_cov, Z_cell, CPE_params, Culture_params):
    _dat_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "JoeWCulturedata.dat")
    Z_Wegener = np.loadtxt(_dat_path, skiprows=9, delimiter=',')[:, 3]
    f_Wegener = np.geomspace(1, 1e6, len(Z_Wegener))
    A,B, n = CPE_params
    alpha, Rb, Cm = Culture_params
    Zn = Z_CPE_B(f, A, B, n)
    Zc = GKSpectre(alpha, Rb, Cm, Zn*ae, f, B, ae)[0]
    marker_alpha = 0.7
    # Impedance Module
    ax2.set_xscale('log'); ax2.set_yscale('log')
    ax2.plot(f, np.abs(Zn)      ,'^', alpha=marker_alpha, label='CPE Bare electrode')
    ax2.plot(f, np.abs(Zc)      ,'D', alpha=marker_alpha, label='Giaver & Keese Model')
    ax2.plot(f, np.abs(Z_cov+B) ,'o', alpha=marker_alpha, label='Finite Diff. Model')
    ax2.plot(f, np.abs(Z_cell+B),'+', alpha=marker_alpha, label='Central cell Diff. Model')
    ax2.plot(f_Wegener, np.abs(Z_Wegener),'s', alpha=marker_alpha/2, label='Arndt et al. reported confluent culture')
    ax2.set_xlabel('Frequency [Hz]'); ax2.set_ylabel(r'|Z| [$\Omega$]')
    ax2.grid(True, which='both', linestyle=':')

    # Phase
    ax3.set_xscale('log')
    ax3.plot(f, np.angle(Zn, deg=True)        ,'^', alpha=marker_alpha, label='CPE Bare electrode')
    ax3.plot(f, np.angle(Zc, deg=True)        ,'D', alpha=marker_alpha, label='Giaver & Keese Model')
    ax3.plot(f, np.angle(Z_cov+B, deg=True)   ,'o', alpha=marker_alpha, label='Finite Diff. Model')
    ax3.plot(f, np.angle(Z_cell+B, deg = True),'+', alpha=marker_alpha, label='Central cell Diff. Model')
    ax3.set_xlabel('Frequency [Hz]'); ax3.set_ylabel('Phase [°]')
    ax3.grid(True, which='both', linestyle=':')
    
    # Resistance
    ax4.set_xscale('log'); ax4.set_yscale('log')
    ax4.plot(f, Zn.real        ,'^', alpha=marker_alpha, label='CPE Bare electrode')
    ax4.plot(f, Zc.real        ,'D', alpha=marker_alpha, label='Giaver & Keese Model')
    ax4.plot(f, (Z_cov+B).real ,'o', alpha=marker_alpha, label='Finite Diff. Model')
    ax4.plot(f, (Z_cell+B).real,'+', alpha=marker_alpha, label='Central cell Diff. Model')
    ax4.set_xlabel('Frequency [Hz]'); ax4.set_ylabel(r'R [$\Omega$]')
    ax4.grid(True, which='both', linestyle=':')
    
    # Capacitance
    ax5.set_xscale('log'); ax5.set_yscale('log')
    ax5.plot(f, -1/(2*np.pi*f*Zn.imag)        , '^', alpha=marker_alpha,  label='CPE Bare electrode')
    ax5.plot(f, -1/(2*np.pi*f*Zc.imag)        , 'D', alpha=marker_alpha,  label='Giaver & Keese Model')
    ax5.plot(f, -1/(2*np.pi*f*(Z_cov+B).imag) , 'o', alpha=marker_alpha,  label='Finite Diff. Model')
    ax5.plot(f, -1/(2*np.pi*f*(Z_cell+B).imag), '+', alpha=marker_alpha,  label='Central cell Diff. Model')
    ax5.set_xlabel('Frequency [Hz]')
    ax5.set_ylabel('C [F]')
    ax5.grid(True, which='both', linestyle=':')

    # Shared legend anchored to the bottom of the figure, centred across all four subplots
    handles, labels = ax2.get_legend_handles_labels()
    fig.legend(handles, labels, loc='lower center', bbox_to_anchor=(0.5, 0.0),
               ncol=len(handles), frameon=True)
    fig.subplots_adjust(bottom=0.05)

def Params_text(Culture_vec, Substrate_vec, System_params, CPE_params,
                Culture_params, M_NNZ: int, Simul_: int = 0, cell_counts=None):
    """
    Generate formatted parameter text for plot.
    """
    lado_, rho, de, l, n = System_params
    A, B, N = CPE_params
    alpha, Rb, Cm = Culture_params
    
    dim = int(lado_**2*(n+1)**2 + 2*(n+1)*lado_ + 1)
    side = lado_*(n+1) + 1
    d = lado_*l/side
    
    # Culture statistics
    subs_num = np.sum(Substrate_vec == 1)
    cult_alive = np.sum(Culture_vec >= 1)
    cult_dead = np.sum(Culture_vec == 0)
    
    # Overlap statistics (cells on electrode)
    subs_alive = np.sum((Culture_vec + Substrate_vec) == 2) + \
                 np.sum((Culture_vec + Substrate_vec) == 9)
    
    # Convert to physical units
    alive_cells_physical = np.round(cult_alive * d**2 / l**2)
    dead_cells_physical = np.round(cult_dead * d**2 / l**2)
    elec_cells_physical = subs_num * d**2 // l**2
    elec_alive_physical = subs_alive * d**2 // l**2
    
    # Matrix info
    dim_squared = dim**2
    sparsity = 100 * M_NNZ / dim_squared if M_NNZ > 0 else 0
    
    _apo_text = ""
    if cell_counts is not None:
        _stage_key  = {SystemConst.APOTOSIS[0]: 'apo_10', SystemConst.APOTOSIS[1]: 'apo_7', SystemConst.APOTOSIS[2]: 'apo_3_5'}
        _ordinals   = ['1st', '2nd', '3th']
        _apo_stages = SystemConst.APOTOSIS[:-1]
        _total = cell_counts['total']
        _stage_parts = '  '.join(
            f"{_ordinals[i]}→{cell_counts[_stage_key[s]]}"
            for i, s in enumerate(_apo_stages)
        )
        _total_apo = sum(cell_counts[_stage_key[s]] for s in _apo_stages)
        _apo_text = (
            f"    $\\bullet$ Apo stages = [{_stage_parts}]\n"
            f"    $\\bullet$ Total apo = {_total_apo} ({100*_total_apo/_total:.1f}%)\n"
        )

    params = fr"""$\bf{{Simulation\ Parameters}}$
    $\bullet$ Culture size = {lado_**2} cells
    $\bullet$ Alive cells = {alive_cells_physical:.0f} ({100*cult_alive/dim:.2f}%)
    $\bullet$ Dead cells = {dead_cells_physical:.0f} ({100*cult_dead/dim:.2f}%)
{_apo_text}    $\bullet$ Electrode area = {elec_cells_physical:.0f} cells ({100*subs_num/dim:.2f}%)
    $\bullet$ Cells on electrode = {elec_alive_physical:.0f} ({100*subs_alive/subs_num:.2f}% coverage)
    $\bullet$ Resolution n = {n}
    $\bullet$ Matrix size = {dim_squared:.2e}
    $\bullet$ Non-zero elements = {M_NNZ} ({sparsity:.3f}%)

$\bf{{Physical\ Geometry}}$
    $\bullet$ Medium resistivity ρ = {rho:.2f} $\Omega\cdot$cm
    $\bullet$ Electrode diameter = {10000*de:.2f} $\mu$m
    $\bullet$ Cell side length = {10000*l:.2f} $\mu$m
    $\bullet$ Discretization d = {10000*d:.2f} $\mu$m

$\bf{{CPE\ Parameters}}$
    $\bullet$ A = {A:.2e} $\Omega^{{-1}}\cdot s^{{n}}$
    $\bullet$ n = {N:.3f}
    $\bullet$ R_constr = {B:.1f}  $\Omega$

$\bf{{Cell\ Model\ Parameters}}$
    $\bullet$ $\alpha$ = {alpha.real:.3f} $\sqrt{{\Omega\cdot\text{{cm}}}}$ 
    $\bullet$ R_b = {Rb.real:.3f}  $\Omega\cdot\text{{cm}}^2$
    $\bullet$ C_m = {Cm.real:.2e}  $\text{{F/cm}}^2$
    $\bullet$ h = {rho*(np.sqrt(l*l / np.pi)/alpha)**2:.3f} $\sqrt{{\Omega\cdot\text{{cm}}}}$ 
    
$\bf{{Simulation\ Status}}$
    $\bullet$ Completed = {Simul_ > 0}
    $\bullet$ Total time = {Simul_:.0f} s
    """
    return params


def write_Header(filepath, Culture_vec, Substrate_vec, System_params,
                CPE_params, Culture_params, Simul_params, freq, cell_counts=None):
    """
    Write header to output file with simulation metadata.
    
    Improvements:
    - More structured format
    - Better readability
    - Include all relevant parameters
    """
    lado_, rho, de, l, n = System_params
    A, B, N = CPE_params
    alpha, Rb, Cm = Culture_params
    
    dim = int(lado_**2*(n+1)**2 + 2*(n+1)*lado_ + 1)
    side = lado_*(n+1) + 1
    d = lado_*l/side
    
    # Statistics
    subs_num = np.sum(Substrate_vec == 1)
    cult_alive = np.sum(Culture_vec >= 1)
    cult_dead = np.sum(Culture_vec == 0)
    subs_alive = np.sum((Culture_vec + Substrate_vec) == 2) + \
                 np.sum((Culture_vec + Substrate_vec) == 9)

    # Apoptosis stage summary lines
    _apo_lines = ""
    if cell_counts is not None:
        _stage_key  = {SystemConst.APOTOSIS[0]: 'apo_10', SystemConst.APOTOSIS[1]: 'apo_7', SystemConst.APOTOSIS[2]: 'apo_3_5'}
        _ordinals   = ['1st', '2nd', '3th']
        _apo_stages = SystemConst.APOTOSIS[:-1]   # [10, 7, 5]
        _total = cell_counts['total']
        _stage_str = '  '.join(
            f"{_ordinals[i]}: {cell_counts[_stage_key[s]]} ({100*cell_counts[_stage_key[s]]/_total:.1f}%)"
            for i, s in enumerate(_apo_stages)
        )
        _total_apo = sum(cell_counts[_stage_key[s]] for s in _apo_stages)
        _apo_lines = (
            f"Apoptosis stages: [{_stage_str}]\n"
            f"Total apoptosis cells: {_total_apo} ({100*_total_apo/_total:.1f}%)\n"
        )

    # Generar SIMULATION SPECIFICS según tipo
    sim_specifics = f"""SIMULATION SPECIFICS
Simulation type: Apoptotic process
Culture apoptotic percentage per step: { Simul_params[1] * 100:.2f}%
Evolutive stage: {Simul_params[2]}
Iteration: { Simul_params[3]}

"""
    header = f"""Simulation Results
Generated: {np.datetime64('now')}

FREQUENCY SWEEP
Min frequency: {freq[0]:.6e} Hz
Max frequency: {freq[-1]:.6e} Hz
Number of points: {len(freq)}

SIMULATION PARAMETERS
Resolution n: {n}
Culture size: {lado_**2} cells
Alive cells: {np.round(cult_alive*d**2/l**2):.0f} ({100*cult_alive/dim:.2f}%)
Dead cells: {np.round(cult_dead*d**2/l**2):.0f} ({100*cult_dead/dim:.2f}%)
{_apo_lines}Electrode cells: {subs_num*d**2//l**2:.0f} ({100*subs_num/dim:.2f}%)
Cells on electrode: {subs_alive*d**2//l**2:.0f} ({100*subs_alive/subs_num:.2f}% coverage)

{sim_specifics}

GEOMETRY
Electrode diameter: {10000*de:.2f} 
Cell side length: {10000*l:.3f} 
Discretization: {10000*d:.4f} 

CPE PARAMETERS
A: {A:.6e} 
n: {N:.6f}
R_constr: {B:.3f} 

CELL MODEL PARAMETERS
Medium resistivity: {rho:.2f}
Alpha: {alpha.real:.4f} 
R_b: {Rb.real:.4f} 
C_m: {Cm.real:.6e} 

DATA COLUMNS
Column 1: MEA well number (always 0 in this version)
Column 2: Simulation time [s]
Column 3: Frequency [Hz]
Column 4: Complex impedance Z (format: real+imagj)

MEA\tt_simul\tfreq\tZ
"""
    
    with open(filepath, "w") as file: file.write(header)
    return