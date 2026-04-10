"""
SolveMatrix.py — ECIS Finite Difference Solver
================================================

PARDISO optimization — phase separation:
  Phase 11 (symbolic analysis):      1×  — sparsity pattern is invariant across frequencies
  Phase 22 (numerical factorization): N×  — only diagonal values change between frequencies
  Phase 33 (solve):                   N×  — forward/backward substitution

The sparsity pattern of A_real = [[Re_M, -Im_M], [Im_M, Re_M]] is identical
for every frequency: only M's diagonal values change. This means phase 11
(the expensive reordering and elimination tree computation) only needs to
run once. Previous implementation called phase 12 (11+22) every frequency.

Additional optimizations:
  - A_real.data updated in-place between frequencies (no reallocation)
  - Rb diagonal term absorbed into static base (c_rb is frequency-independent)
  - VM=0 → membrane RHS term is always zero, removed from inner loop
  - Position arrays for diagonal elements precomputed once before the loop
"""

import numpy as np
from scipy.sparse import csr_matrix, lil_matrix, bmat
from scipy.sparse.linalg import spsolve
import warnings
from scipy.sparse import SparseEfficiencyWarning
from typing import Tuple

warnings.simplefilter('ignore', SparseEfficiencyWarning)


# ============================================================================
# BASE SYSTEM BUILDER
# ============================================================================

def build_base_system_structure(
    n: int,
    lado: int,
    rc: float,
    alpha: complex,
    Culture_vector: np.ndarray
) -> Tuple[csr_matrix, np.ndarray, np.ndarray, np.ndarray]:
    """
    Build the frequency-INDEPENDENT part of the system matrix.

    Returns
    -------
    M_base          : CSR matrix — Laplacian with lateral current flow only
    membrane_indices: tile indices with capacitive membrane impedance (Culture==1)
    Rb_indices      : tile indices with intercellular junction impedance (Culture>2)
    dead_cell_indices: tile indices of dead cells (Culture==0)
    """
    dim  = int(lado**2*(n+1)**2 + 2*(n+1)*lado + 1)
    side = int(np.sqrt(dim))

    c_curr = (rc/alpha)**2 + 0j   # lateral current conductance [frequency-independent]

    M = lil_matrix((dim, dim), dtype=complex)
    D = np.arange(dim)

    # Interior: 4-way Von Neumann connectivity
    M[D, D] = 4*c_curr

    upper = D[:-side]; lower = D[side:]
    M[upper, lower] = -c_curr
    M[lower, upper] = -c_curr

    left_mask  = D % side != 0
    M[D[left_mask],  D[left_mask]  - 1] = -c_curr

    right_mask = (D + 1) % side != 0
    M[D[right_mask], D[right_mask] + 1] = -c_curr

    # Border correction: boundary nodes have fewer neighbors → add c_curr back
    diag = M.diagonal().copy()
    diag[:side]  += c_curr      # bottom border
    diag[-side:] += c_curr      # top border
    lr_borders = np.concatenate([
        np.arange(0,       dim, side, dtype=int),
        np.arange(side-1,  dim, side, dtype=int),
    ])
    diag[lr_borders] += c_curr
    M.setdiag(diag)

    M_base = M.tocsr()

    membrane_indices  = np.where(Culture_vector == 1)[0]
    Rb_indices        = np.where(Culture_vector >  2)[0]
    dead_cell_indices = np.where(Culture_vector == 0)[0]
    membrane_indices  = np.setdiff1d(membrane_indices, dead_cell_indices)

    return M_base, membrane_indices, Rb_indices, dead_cell_indices

# ============================================================================
# PARDISO UTILITIES
# ============================================================================

_PARDISO_AVAILABLE = None

def _check_pardiso() -> bool:
    global _PARDISO_AVAILABLE
    if _PARDISO_AVAILABLE is None:
        try:
            from pypardiso.pardiso_wrapper import PyPardisoSolver
            _PARDISO_AVAILABLE = True
        except ImportError:
            _PARDISO_AVAILABLE = False
    return _PARDISO_AVAILABLE

def _find_diag_positions_in_A_real(
    A_real: csr_matrix,
    dim: int,
    indices: np.ndarray
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Precompute the 4 positions in A_real.data[] that correspond to each
    diagonal entry of M for the given index set.

    A_real = [[Re_M, -Im_M], [Im_M, Re_M]]  (2×dim real expansion)

    For each i in `indices`, four positions in A_real.data[]:
      pos_tl : (i,     i    )  ← stores  Re(M[i,i])
      pos_tr : (i,     i+dim)  ← stores -Im(M[i,i])
      pos_bl : (i+dim, i    )  ← stores  Im(M[i,i])
      pos_br : (i+dim, i+dim)  ← stores  Re(M[i,i])

    Called once before the frequency loop; O(len(indices) × avg_row_nnz).
    """
    indices  = np.asarray(indices, dtype=np.intp)
    n_idx    = len(indices)
    indptr   = A_real.indptr
    data_col = A_real.indices

    pos_tl = np.empty(n_idx, dtype=np.intp)
    pos_tr = np.empty(n_idx, dtype=np.intp)
    pos_bl = np.empty(n_idx, dtype=np.intp)
    pos_br = np.empty(n_idx, dtype=np.intp)

    # Pre-fetch row start/end arrays (avoids repeated Python indexing in loop)
    rs_top = indptr[indices]
    re_top = indptr[indices + 1]
    rs_bot = indptr[indices + dim]
    re_bot = indptr[indices + dim + 1]

    for k in range(n_idx):
        i = int(indices[k])

        # Top block row i: columns 0..dim-1 (Re_M part) | dim..2dim-1 (Im_M part)
        rc_t = data_col[rs_top[k]:re_top[k]]
        pos_tl[k] = rs_top[k] + rc_t.searchsorted(i)
        pos_tr[k] = rs_top[k] + rc_t.searchsorted(i + dim)

        # Bottom block row i+dim
        rc_b = data_col[rs_bot[k]:re_bot[k]]
        pos_bl[k] = rs_bot[k] + rc_b.searchsorted(i)
        pos_br[k] = rs_bot[k] + rc_b.searchsorted(i + dim)

    return pos_tl, pos_tr, pos_bl, pos_br

def _build_initial_A_real(
    M_static_diag: np.ndarray,
    M_base: csr_matrix,
    membrane_idx: np.ndarray,
    substrate_idx: np.ndarray,
    freq0: float,
    Zn0: complex,
    d: float,
    Cm: complex
) -> csr_matrix:
    """
    Build A_real at the first frequency to establish the sparsity pattern.
    The pattern is reused for all subsequent frequencies.
    """
    c_memb0 = d**2 * 2j*np.pi*freq0*(Cm/2)     # d²/Zm, Zm = -j/(2πf·Cm/2)
    c_elec0 = d**2 / Zn0

    diag0 = M_static_diag.copy()
    if len(membrane_idx)  > 0: diag0[membrane_idx]  += c_memb0
    if len(substrate_idx) > 0: diag0[substrate_idx] += c_elec0

    M0 = M_base.copy()
    M0.setdiag(diag0)

    Re0 = M0.real.tocsr()
    Im0 = M0.imag.tocsr()
    return bmat([[Re0, -Im0], [Im0, Re0]], format='csr'), M0.nnz


# ============================================================================
# MAIN SOLVER
# ============================================================================

def V_vector(
    n: int,
    d: float,
    lado: int,
    freq_array: np.ndarray,
    Zn_array: np.ndarray,
    rc: float,
    alpha: complex,
    Rb: complex,
    Cm: complex,
    Substrate_vector: np.ndarray,
    Culture_vector: np.ndarray,
    solver_mode: str = 'pardiso'
) -> Tuple[np.ndarray, int]:
    """
    Solve ECIS finite-difference system for all frequencies.

    Parameters
    ----------
    solver_mode : 'pardiso' | 'auto' | 'direct'
        'pardiso'/'auto' : use PyPardiso with phase-separated PARDISO calls
        'direct'         : scipy spsolve fallback

    Returns
    -------
    V_solutions : (num_freq, dim) complex array of voltage solutions
    M_nnz       : number of non-zeros in the physical matrix M (for reporting)
    """
    dim      = int(lado**2*(n+1)**2 + 2*(n+1)*lado + 1)
    num_freq = len(freq_array)
    VN = 1.0+0j
    VM = 0.0+0j   # Counter electrode potential; VM=0 → many RHS terms vanish

    # ── Build frequency-independent base ─────────────────────────────────────
    M_base, membrane_idx, Rb_idx, dead_idx = build_base_system_structure(
        n, lado, rc, alpha, Culture_vector
    )

    c_curr = (rc/alpha)**2 + 0j
    c_rb   = (n*d)**2 / (Rb*2*(n+1)) + 0j if len(Rb_idx) > 0 else 0.0+0j

    # Absorb dead cells permanently into M_base (constant, frequency-independent)
    if len(dead_idx) > 0:
        dead_mod = lil_matrix((dim, dim), dtype=complex)
        dead_mod[dead_idx, dead_idx] = 100*c_curr
        M_base = (M_base + dead_mod.tocsr()).tocsr()

    # Absorb Rb into static diagonal permanently (c_rb is frequency-independent)
    M_static_diag = M_base.diagonal().copy()
    if len(Rb_idx) > 0:
        M_static_diag[Rb_idx] += c_rb

    # Electrode indices (excluding dead cells)
    substrate_idx = np.setdiff1d(np.where(Substrate_vector == 1)[0], dead_idx)

    # Precompute which positions in freq_idx belong to each group (constant)
    # Only membrane (c_memb) and substrate (c_elec) vary with frequency. c_rb is already absorbed into M_static_diag.
    parts = [membrane_idx, substrate_idx]
    freq_idx = np.unique(np.concatenate(parts)).astype(np.intp)

    memb_mask = np.isin(freq_idx, membrane_idx)  # boolean, shape (len(freq_idx),)
    subs_mask = np.isin(freq_idx, substrate_idx)

    # Base values at freq_idx positions (includes Rb if overlap)
    base_vals = M_static_diag[freq_idx]  # complex, shape (len(freq_idx),)

    V_solutions = np.zeros((num_freq, dim), dtype=complex)

    if (solver_mode in ('pardiso', 'auto')) and _check_pardiso():
        from pypardiso.pardiso_wrapper import PyPardisoSolver
        pds = PyPardisoSolver(mtype=11)

        # Build A_real at freq[0] to fix the sparsity pattern
        A_real, M_nnz = _build_initial_A_real(
            M_static_diag, M_base, membrane_idx, substrate_idx,
            freq_array[0], Zn_array[0], d, Cm
        )

        # Precompute positions in A_real.data[] for all freq-varying indices
        # This loop runs ONCE — one-time O(len(freq_idx) × row_nnz) setup cost
        pos_tl, pos_tr, pos_bl, pos_br = _find_diag_positions_in_A_real(
            A_real, dim, freq_idx
        )

        # Pardiso requires Fortran-contiguous RHS
        b_dummy = np.zeros(2*dim, dtype=np.float64, order='F')

        # ── Phase 11: symbolic analysis — exactly ONCE ────────────────────
        # Computes fill-reducing reordering and symbolic factorization.
        # Valid for all frequencies since sparsity pattern never changes.
        try:
            pds.set_phase(11)
            pds._call_pardiso(A_real, b_dummy)
        except Exception as e:
            print(f"⚠️  PARDISO phase 11 failed ({e}), falling back to phase-12 per frequency")
            _pardiso_fallback(
                pds, A_real, freq_array, Zn_array, d, Cm,
                M_static_diag, M_base, membrane_idx, substrate_idx,
                dim, V_solutions, VM, VN
            )
            pds.free_memory(everything=True)
            return V_solutions, M_nnz

        # ── Phase 22 + 33 per frequency ───────────────────────────────────
        for i, (freq, Zn) in enumerate(zip(freq_array, Zn_array)):
            # c_memb = d²/Zm, Zm = -j/(2πf·Cm/2)  →  c_memb = j·d²·2πf·Cm/2
            c_memb = d**2 * 2j*np.pi*freq*(Cm/2)
            c_elec = d**2 / Zn

            # New diagonal values at freq_idx only
            new_vals = base_vals.copy()
            new_vals[memb_mask] += c_memb
            new_vals[subs_mask] += c_elec

            # ── In-place update of A_real.data — no allocation ────────────
            # A_real = [[Re_M, -Im_M], [Im_M, Re_M]]:
            #   top-left  (i,i)     ←  Re(new_val)
            #   top-right (i,i+dim) ← -Im(new_val)
            #   bot-left  (i+dim,i) ←  Im(new_val)
            #   bot-right (i+dim,i+dim) ← Re(new_val)
            A_real.data[pos_tl] = new_vals.real
            A_real.data[pos_tr] = -new_vals.imag
            A_real.data[pos_bl] = new_vals.imag
            A_real.data[pos_br] = new_vals.real

            # ── Phase 22: numerical factorization only ────────────────────
            # Reuses elimination tree from phase 11 → much faster than phase 12
            pds.set_phase(22)
            pds._call_pardiso(A_real, b_dummy)

            # ── Build RHS ────────────────────────────────────────────────
            # VM=0 → membrane contribution to C is zero
            # Only electrode term matters: C[substrate_idx] = VN * c_elec
            C = np.zeros(dim, dtype=complex)
            if len(substrate_idx) > 0:
                C[substrate_idx] = VN * c_elec   # VN=1 → just c_elec

            b_real = np.asfortranarray(
                np.concatenate([C.real, C.imag])
            )

            # ── Phase 33: forward/backward substitution ───────────────────
            pds.set_phase(33)
            x_real = pds._call_pardiso(A_real, b_real)
            V_solutions[i, :] = x_real[:dim] + 1j*x_real[dim:]

        pds.free_memory(everything=True)
        return V_solutions, M_nnz

    # ================================================================
    # Fallback: scipy spsolve
    # ================================================================
    for i, (freq, Zn) in enumerate(zip(freq_array, Zn_array)):
        c_memb = d**2 * 2j*np.pi*freq*(Cm/2)
        c_elec = d**2 / Zn

        M_diag = M_static_diag.copy()
        if len(membrane_idx)  > 0: M_diag[membrane_idx]  += c_memb
        if len(substrate_idx) > 0: M_diag[substrate_idx] += c_elec

        M = M_base.copy()
        M.setdiag(M_diag)

        C = np.zeros(dim, dtype=complex)
        if len(substrate_idx) > 0: C[substrate_idx] = VN * c_elec

        V_solutions[i, :] = spsolve(M, C)

    M_for_nnz = M_base.copy()
    M_for_nnz.setdiag(M_static_diag)
    return V_solutions, M_for_nnz.nnz


# ============================================================================
# FALLBACK (old behavior, phase 12 per frequency)
# ============================================================================

def _pardiso_fallback(
    pds, A_real, freq_array, Zn_array, d, Cm,
    M_static_diag, M_base, membrane_idx, substrate_idx,
    dim, V_solutions, VM, VN
):
    """Old full-factorize path, used only if phase 11 fails."""
    print("   Running fallback: phase 12+33 per frequency")
    for i, (freq, Zn) in enumerate(zip(freq_array, Zn_array)):
        c_memb = d**2 * 2j*np.pi*freq*(Cm/2)
        c_elec = d**2 / Zn

        M_diag = M_static_diag.copy()
        if len(membrane_idx)  > 0: M_diag[membrane_idx]  += c_memb
        if len(substrate_idx) > 0: M_diag[substrate_idx] += c_elec

        M_i = M_base.copy()
        M_i.setdiag(M_diag)

        Re_i = M_i.real.tocsr()
        Im_i = M_i.imag.tocsr()
        A_i  = bmat([[Re_i, -Im_i], [Im_i, Re_i]], format='csr')

        C = np.zeros(dim, dtype=complex)
        if len(substrate_idx) > 0: C[substrate_idx] = VN * c_elec
        b_real = np.asfortranarray(np.concatenate([C.real, C.imag]))

        pds.factorize(A_i)
        x_real = pds.solve(A_i, b_real)
        V_solutions[i, :] = x_real[:dim] + 1j*x_real[dim:]