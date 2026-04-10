import os

# ============================================================================
# THREAD CONTROL — must be set BEFORE any numpy/MKL import
# Rule: N_JOBS × MKL_NUM_THREADS = physical cores
# ============================================================================
N_JOBS      = 2   # Parallel joblib workers
MKL_THREADS = 3   # MKL/PARDISO threads per worker

os.environ["MKL_NUM_THREADS"]         = str(MKL_THREADS)
os.environ["OMP_NUM_THREADS"]         = str(MKL_THREADS)
os.environ["OPENBLAS_NUM_THREADS"]    = str(MKL_THREADS)
os.environ["VECLIB_MAXIMUM_THREADS"]  = str(MKL_THREADS)
os.environ["NUMEXPR_NUM_THREADS"]     = str(MKL_THREADS)
os.environ["LOKY_MAX_WORKER_TIMEOUT"] = "750"

import numpy as np
import itertools
import pandas as pd
import re
import sys
from tqdm import tqdm
from joblib import Parallel, delayed
from pathlib import Path

from main import main


def lof_results(subfolder: Path, lenfreq: int = 10, min_steps: int = 25):
    """
    Scan subfolder for completed apoptotic simulations.

    Each call to main() produces one file per step. A 'run' is the full
    temporal evolution identified by (ac, n, alpha, Rb, Cm, Percentage, iter).
    The log records one row per run with the number of steps found.
    status=True only when steps_completed >= min_steps.
    """
    pattern = re.compile(
        r"Z_apo_ac(?P<ac>[\d\.]+)_n_(?P<n>\d+)"
        r"_Alp(?P<Alp>[\d\.]+)_Rb(?P<Rb>[\d\.]+)"
        r"_Cm(?P<Cm>[\d\.eE\-\+]+)"
        r"_Per(?P<Per>[\d\.]+)_step(?P<step>\d+)_iter(?P<iter>\d+)\.txt$"
    )

    # Group files by run key, track highest valid step found
    runs = {}   # key → max step with valid data

    for f in subfolder.glob("Z_apo_*.txt"):
        m = pattern.search(f.name)
        if not m:
            continue
        try:
            data = np.loadtxt(f, dtype=complex, skiprows=49)
            if len(data) < lenfreq:
                continue
        except Exception:
            continue

        key = (
            round(float(m.group("ac")),  2),
            int(m.group("n")),
            round(float(m.group("Alp")), 2),
            round(float(m.group("Rb")),  3),
            round(float(m.group("Cm")),  9),
            round(float(m.group("Per")), 2),
            int(m.group("iter")),
        )
        step = int(m.group("step"))
        runs[key] = max(runs.get(key, -1), step)

    records = []
    for (ac, n_val, Alp, Rb, Cm, Per, iter_), max_step in runs.items():
        steps_completed = max_step + 1
        records.append({
            "status":          steps_completed >= min_steps,
            "ac":              ac,
            "n":               n_val,
            "alpha":           Alp,
            "Rb":              Rb,
            "Cm":              Cm,
            "Percentage":      Per,
            "iteration":       iter_,
            "steps_completed": steps_completed,
        })

    if records:
        df = pd.DataFrame(records)
        log_path = subfolder / "log.csv"
        df.to_csv(log_path, index=False)
        print(f"  Logged {len(records)} runs in {subfolder.name}/log.csv")
    else:
        print(f"  No completed simulations found in {subfolder.name}")

    return len(records)


# ============================================================================
# SIMULATION PARAMETERS
# ============================================================================

Plot_bool   = True
SOLVER_MODE = 'pardiso'

# Subcellular resolution
n = 15

# Frequency range — Wegener et al. (2004): 1 Hz to 1 MHz
freqs = np.geomspace(1, 1e6, 13)

# Maximum apoptosis steps per simulation run
max_step = 30
# Minimum steps for a run to be considered complete
MIN_STEPS = 25

# --- Electrode geometry — Wegener et al. (2004) ---
# Working electrode diameter: 2 mm = 2000 µm. Converted to cm via *1e-4 when calling main().
#ae = 3*1e6 #um2 ~ 2000 um
des = np.array([2000.0])   # [µm]
# --- Cell area — Wegener: 100,000 cells/cm² → 1000 µm² = 1e-5 cm² ---
# Runner stores ac in units where ac_cm2 = ac * 1e-6, so 1e-5 cm² → ac = 10.
acs = np.array([1700.0])     # [cm² × 1e6]

# --- Biophysical parameters — Wegener Table 2, SFM baseline ---
#alphas = np.array([25,30])        # α [Ω^0.5·cm]    baseline: 34 ± 9
#Rbs    = np.array([300])       # Rb [Ω·cm²]       baseline: 142 ± 80
#Cms    = np.array([1.1e-6])     # Cm [F/cm²]       baseline: 1.09 ± 0.12 µF/cm²
alphas = np.array([25,34,43])        # α [Ω^0.5·cm]    baseline: 34 ± 9
Rbs    = np.array([250,140.0,120])       # Rb [Ω·cm²]       baseline: 142 ± 80
Cms    = np.array([1.05e-6,1.1e-6,1.15e-6])     # Cm [F/cm²]       baseline: 1.09 ± 0.12 µF/cm²

# --- Apoptosis progression ---
# Fraction of currently live cells that enter apoptosis at each step.
Percentages  = np.array([0.01])#,0.05, 0.10, 0.20])
n_iterations = 1   # Independent random realizations per parameter combination
max_step = 100
# --- CPE parameters (update after fitting the Wegener experimental spectrum) ---
A = 3.6e-7   # CPE prefactor  — PLACEHOLDER
N = 0.95      # CPE exponent   — PLACEHOLDER
B = 260.0    # Series resistance [Ω] — PLACEHOLDER

# ============================================================================
# FOLDER STRUCTURE AND EXECUTION
# ============================================================================

for de in des:
    base_folder = (
        Path("") / f"Simulations/Simul_de_{de:.2f}_A{A:.2e}_N{N:.2e}_B{B:.2e}"
    )
    base_folder.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*70}")
    print(f"Electrode : de={de:.0f} µm  |  A={A:.2e}  N={N:.2f}  B={B:.1f}")
    print(f"Base folder: {base_folder}")
    print(f"{'='*70}\n")

    for ac in acs:
        subfolder = base_folder / f"apo_ac{ac:.2f}"
        subfolder.mkdir(parents=True, exist_ok=True)

        ac_um2 = ac   # ac [cm²×1e6] × 1e-6 cm²/µm_unit × 1e8 µm²/cm² = ac × 100 µm²
        print(f"\n{'-'*70}")
        print(f"Cell area : {ac:.2f} [cm²×1e6]  =  {ac_um2:.0f} µm²")
        print(f"Subfolder : {subfolder}")
        print(f"{'-'*70}")

        param_list = list(itertools.product(
            alphas, Rbs, Cms, Percentages, range(n_iterations)
        ))

        # Scan existing results and build log
        print("Scanning for completed simulations...")
        lof_results(subfolder, len(freqs), MIN_STEPS)

        log_path = subfolder / "log.csv"
        if log_path.exists():
            log_df = pd.read_csv(log_path)
            print(f"Log: {len(log_df)} completed runs found")
        else:
            log_df = pd.DataFrame(columns=[
                "status", "ac", "n", "alpha", "Rb", "Cm",
                "Percentage", "iteration", "steps_completed"
            ])
            print("No existing log — starting fresh")

        # ====================================================================
        # SIMULATION FUNCTION
        # ====================================================================

        def run_simulation(alpha, Rb, Cm, Percentage, iteration):
            label = (
                f"ac{ac:.2f}_n_{n}_Alp{alpha:.02f}_Rb{Rb:.03f}"
                f"_Cm{Cm:.2e}_Per{Percentage:.2f}_iter{iteration}"
            )

            is_completed = (
                (log_df["ac"].round(2)        == round(ac * 1e-2,   2)) &
                (log_df["n"]                  == n)                     &
                (log_df["alpha"].round(2)      == round(alpha,      2)) &
                (log_df["Rb"].round(3)         == round(Rb,         3)) &
                (log_df["Cm"].round(9)         == round(Cm,         9)) &
                (log_df["Percentage"].round(2) == round(Percentage, 2)) &
                (log_df["iteration"]           == iteration)            &
                (log_df["status"]              == True)
            ).any()

            if is_completed:
                print('is completed')
                return

            print(f"  Running: {label}")
            try:
                main(
                    f=freqs,
                    de=de * 1e-4,
                    ac=ac * 1e-8,
                    alpha=alpha + 0j,
                    Rb=Rb    + 0j,
                    Cm=Cm    + 0j,
                    n=n,
                    A=A, N=N, B=B,
                    Percentage=Percentage,
                    iter=iteration,
                    seed=iteration,
                    max_step=max_step,
                    Folder=subfolder,
                    Plotting=Plot_bool,
                    solver_mode=SOLVER_MODE,
                )
                return "success"
            except KeyboardInterrupt:
                raise
            except Exception as e:
                print(f"  Failed {label}: {e}")
                return "error"

        # ====================================================================
        # PARALLEL EXECUTION
        # ====================================================================

        print(f"\nLaunching: {N_JOBS} workers × {MKL_THREADS} MKL threads")
        print(f"Total runs: {len(param_list)}")

        try:
            Parallel(n_jobs=N_JOBS, backend="loky", verbose=0)(
                delayed(run_simulation)(*args)
                for args in tqdm(param_list, desc="Apoptosis simulations", unit="run")
            )
            print("\nUpdating log...")
            lof_results(subfolder, len(freqs), MIN_STEPS)

        except KeyboardInterrupt:
            print("\nInterrupted. Saving progress...")
            lof_results(subfolder, len(freqs), MIN_STEPS)
            sys.exit(0)

        except Exception as e:
            print(f"\nCritical error: {e}")
            import traceback
            traceback.print_exc()
            lof_results(subfolder, len(freqs), MIN_STEPS)
            sys.exit(1)

print(f"\n{'='*70}")
print("All simulations completed.")
print(f"{'='*70}")
