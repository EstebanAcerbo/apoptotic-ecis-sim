import sys
import os
import time
import numpy as np
from tqdm import tqdm
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib import rcParams
rcParams.update({'font.size': 12, 'font.family': 'sans-serif', 'mathtext.fontset': 'stix'})

from Calc_Curr import In_value
from CPE_GK_Funs import Z_CPE_B, GKSpectre
from SolveMatrix import V_vector
from SimulSheet_Funcs import Pot_colormap, Map_Electrode, ResultPlotting, Params_text, write_Header
from culture_construction_vectorized import construct_culture_vectorized, construct_substrate_vectorized
from ConstantsFile import SystemConst

def AdvanceApoptosis(Culture_aux, Percentage_flips, Seed=0):
    """
    Randomly kills cells in the culture by flipping bits from 1 to 0.
    
    Args:
        Culture_aux: (lado×lado) array of cell status
        Percentage_flips: Fraction of cells to kill [0, 1]
        Seed: Random seed for reproducibility
        
    Returns:
        Modified Culture_aux with dead cells
    """
    # Input validation
    Percentage_flips = np.clip(Percentage_flips, 0, 1)
    
    # Set random seed if provided
    if Seed != 0: np.random.seed(Seed)
    
    # Find alive cells
    alive_indices = np.where(Culture_aux.ravel() == SystemConst.MEMBRANE)[0]
    
    if len(alive_indices) == 0: return Culture_aux
    # Avance process of apoptosis
    for apo in range(len(SystemConst.APOTOSIS)-1)[::-1]:
        indices_apoptosis = np.where(Culture_aux.ravel() == SystemConst.APOTOSIS[apo])[0]
        if len(indices_apoptosis) != 0:
            Culture_aux[indices_apoptosis] = SystemConst.APOTOSIS[apo+1]

    # Calculate number of cells to start apoptosis
    num_to_apoptosis = int(len(Culture_aux) * Percentage_flips)
    # Randomly select cells to kill
    indices_apoptosis = np.random.choice(alive_indices, size=num_to_apoptosis, replace=False)
    flat_culture = Culture_aux.ravel()
    flat_culture[indices_apoptosis] = SystemConst.APOTOSIS[0]
    Culture_aux = flat_culture.reshape(Culture_aux.shape)
    
    return Culture_aux

def main(
    f=np.geomspace(1, 1e7, 12),
    de: float = 0.2,        # Electrode diameter [cm]
    ac: float = 1700*1e-8,       # Cell area [cm²]
    alpha: complex = 25+0j,
    Rb: complex = 180+0j,
    Cm: complex = 1e-6+0j,
    n: int = 15,
    A: float = 1e-8,
    N: float = 0.9,
    B: float = 720,
    Percentage: float = 0.05,   # For random: 0=confluent baseline, >0=death
    iter: int = 0,
    seed: int = 0,
    max_step: int = 45,
    Folder='Simulations',
    Plotting = True,
    solver_mode: str = 'pardiso'):
    try:
        # ============= SETUP =============
        start_time = time.time()

        # Physical constants
        rho = 70
        ae = np.pi * de**2 / 4
        rc = np.sqrt(ac / np.pi)
        l = np.sqrt(ac)
        
        lado = int(de/l)+5
        if lado%2 == 0: lado+=1
        
        cells = lado**2
        VN = 1.0+0j
        VM = 0.0+0j
        
        dim = int(lado**2*(n+1)**2 + 2*(n+1)*lado + 1)
        side = np.sqrt(dim).astype(int)
        d = lado*l/side
        
        # ============= CONSTRUCT GEOMETRY =============
        Culture_aux = np.ones(lado*lado, dtype=np.float32)
        
        Culture_vector = construct_culture_vectorized(lado, n, Culture_aux)
        Substrate_vector = construct_substrate_vectorized(lado, n, de, l)
        step = 0
        while step < max_step:    
        # ============= COMPUTE CPE IMPEDANCE =============
            Zn = ae * Z_CPE_B(f, A, 0, N)
            
            if Percentage > 0 and step>=1:
                # Random cell death
                Culture_aux = AdvanceApoptosis(Culture_aux, Percentage, Seed=seed)
                Culture_vector = construct_culture_vectorized(lado, n, Culture_aux)

            cell_counts = {
                'total':  lado * lado,
                'alive':  int(np.sum(Culture_aux == SystemConst.MEMBRANE)),
                'apo_10': int(np.sum(Culture_aux == SystemConst.APOTOSIS[0])),
                'apo_7':  int(np.sum(Culture_aux == SystemConst.APOTOSIS[1])),
                'apo_3_5':  int(np.sum(Culture_aux == SystemConst.APOTOSIS[2])),
                'dead':   int(np.sum(Culture_aux == SystemConst.EMPTY)),
            }

            # ============= PREPARE OUTPUT FILES =============
            System_params = [lado, rho, de, l, n]
            CPE_params = [A, B, N]
            Culture_params = [alpha, Rb, Cm]
            
            # Base label with ac
            Label_files = f"ac{ac*1e6:.2f}_n_{n}_Alp{alpha.real:.02f}_Rb{Rb.real:.03f}_Cm{Cm.real:.2e}"
            
            # Set prefix and suffixes based on simulation_type
            Label_files += f"_Per{Percentage:.2f}_step{step}_iter{iter}"
            prefix = "Z_apo"
            Simul_params = ['apo', Percentage, step, iter]

            output_folder = Folder
            
            fileCult = f"{prefix}_{Label_files}.txt"
            #fileCell = f"{prefix}_cell_{Label_files}.txt"

            # Check if there are cells on electrode
            cells_on_electrode = (len(np.where((Culture_vector+Substrate_vector) == 2)[0]) + 
                                len(np.where((Culture_vector+Substrate_vector) == 9)[0]))
            
            if cells_on_electrode > 0:
                # ============= SETUP FIGURE =============
                if Plotting:
                    freq_to_plot = 4
                    fig = plt.figure(figsize=(22, 15))
                    gs = gridspec.GridSpec(2, 8,
                        width_ratios=[1, 1, 1, 1, 1.1, 1.1, 1, 1],
                        height_ratios=[1.3, 1],
                        wspace=0.9, hspace=0.3)

                    ax0 = fig.add_subplot(gs[0, 0:3])
                    ax1 = fig.add_subplot(gs[0, 3:6])
                    text_ax = fig.add_subplot(gs[0, 6:])

                    ax2 = fig.add_subplot(gs[1, 0:2])
                    ax3 = fig.add_subplot(gs[1, 2:4])
                    ax4 = fig.add_subplot(gs[1, 4:6])
                    ax5 = fig.add_subplot(gs[1, 6:])
                    
                    Map_Electrode(ax0, 0.5*Culture_vector+Substrate_vector, de, l, n, lado)
                    text_ax.axis('off')

                write_Header(os.path.join(output_folder, fileCult),
                            Culture_vector, Substrate_vector,
                            System_params, CPE_params, Culture_params, Simul_params, freq=f,
                            cell_counts=cell_counts)
                #write_Header(os.path.join(output_folder, fileCell),
                #            Culture_vector, Substrate_vector,
                #            System_params, CPE_params, Culture_params, Simul_params, freq=f)
                
                # ============= SOLVE SYSTEM =============
                cell = int(0.5*cells)
                
                solve_start = time.time()
                V_solutions, M_NNZ = V_vector(
                    n, d, lado, f, Zn,
                    rc, alpha, Rb, Cm,
                    Substrate_vector, Culture_vector,
                    solver_mode=solver_mode
                )
                
                # Vectorized impedance calculation
                IN_f = In_value(V_solutions, d, Zn, VN, Substrate_vector)
                Z_cov = (VN - VM) / IN_f

                # Central cell impedance
                cell = int(0.5 * cells)
                CentralCell_indices = np.array([
                    range(0, n+2) + side*i + cell*(n+1) + (cell//lado)*(side*n+1)
                    for i in range(0, n+2)
                ]).flatten()
                IN_f_cell = np.sum(VN - V_solutions[:, CentralCell_indices], axis=1) * d**2 / Zn
                Z_cell = ((VN-VM)/IN_f_cell) * ac / ae

                # ============= WRITE RESULTS =============
                tiempos = np.linspace(solve_start - start_time, time.time() - start_time, len(f))
                
                with open(os.path.join(output_folder, fileCult), "a") as file_cult:#, \
                    #open(os.path.join(output_folder, fileCell), "a") as file_cell:
                    for i in tqdm(range(len(f)), desc=f"Writing results {Label_files}", ncols=80):
                        file_cult.write(f"0\t{tiempos[i]:.1f}\t{f[i]:.6e}\t{Z_cov[i]}\n")
                        #file_cell.write(f"0\t{tiempos[i]:.1f}\t{f[i]:.6e}\t{Z_cell[i]}\n")
                if Plotting:
                    Pot_colormap(ax1, V_solutions[freq_to_plot, :], f[freq_to_plot], de, l, lado)
                    Simul_Details = Params_text(Culture_vector, Substrate_vector, System_params,
                                                CPE_params, Culture_params, M_NNZ,
                                                Simul_=int(time.time()-start_time),
                                                cell_counts=cell_counts)
                    text_ax.text(-0.10, .95, Simul_Details, transform=text_ax.transAxes,
                        fontfamily='monospace', fontsize=11, va='top', ha='left',
                        bbox=dict(boxstyle='round', facecolor='white', alpha=0.85))
                    
                    ResultPlotting(fig, ax2, ax3, ax4, ax5, f, ae, Z_cov, Z_cell, CPE_params, Culture_params)
                    plt.savefig(os.path.join(output_folder, Label_files+".png"), dpi=400, bbox_inches='tight')
                    
                    plt.close(fig)
            
            else:
                # No cells on electrode - save bare electrode spectrum
                print("⚠️  No cells on electrode. Saving bare electrode spectrum.")
                write_Header(os.path.join(output_folder, fileCult),
                            Culture_vector, Substrate_vector,
                            System_params, CPE_params, Culture_params, Simul_params, freq=f,
                            cell_counts=cell_counts)
                with open(os.path.join(output_folder, fileCult), "a") as file_cult:
                    for i in tqdm(range(len(f)), desc="Writing bare electrode", ncols=80):
                        file_cult.write(f"0\t{0}\t{f[i]:.6e}\t{Zn[i]/ae}\n")
            
            step += 1

        # Set prefix and suffixes based on simulation_type
        Label_files = f"_Per{Percentage:.2f}_step{101}_iter{iter}"
        prefix = "Z_apo"
        Simul_params = ['apo', Percentage, step, iter]

        output_folder = Folder
        
        fileCult = f"{prefix}_{Label_files}.txt"
        # No cells on electrode - save bare electrode spectrum
        print("⚠️  No cells on electrode. Saving bare electrode spectrum.")
        write_Header(os.path.join(output_folder, fileCult),
                    Culture_vector, Substrate_vector,
                    System_params, CPE_params, Culture_params, Simul_params, freq=f,
                    cell_counts=cell_counts)
        with open(os.path.join(output_folder, fileCult), "a") as file_cult:
            for i in tqdm(range(len(f)), desc="Writing bare electrode", ncols=80):
                file_cult.write(f"0\t{0}\t{f[i]:.6e}\t{Zn[i]/ae}\n")
    except KeyboardInterrupt:
        if Plotting:
            plt.close(fig)
        print("Interrupted by user.")
        sys.exit()
        
    except Exception as e:
        print(f"An error occurred: {str(e)}")
        if Plotting:
            plt.close(fig)
        import traceback
        traceback.print_exc()
        sys.exit()
    
    return

if __name__ == '__main__':
    main()
