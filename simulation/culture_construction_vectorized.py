"""
Vectorized Culture Construction
================================

This module replaces the slow nested-loop culture construction with
fully vectorized numpy operations.

Expected speedup: 50-200x depending on lado and n values.

Key optimizations:
1. Broadcasting instead of loops
2. Pre-computed index arrays
3. Efficient boolean operations for neighbor detection
"""

import numpy as np
from typing import Tuple, Optional
from scipy.ndimage import convolve
from ConstantsFile import SystemConst

def construct_culture_vectorized(
    lado: int,
    n: int,
    Culture_aux: np.ndarray,
) -> np.ndarray:
    """
    Vectorized construction of culture vector and Rb indices.
    Args:
        lado: Number of cells per side
        n: Subcellular resolution (n×n tiles per cell)
        Culture_aux: (lado, lado) array of cell status (1=alive, 0=dead)
        cell_type: 'square' or 'hexagonal' (future)        
    Returns:
        Culture_vector: Flattened vector indicating cell membrane tiles (1)
                       and intercellular junctions (8)
        Substrate_vector: Flattened vector indicating electrode positions
    """
    side = lado * (n + 1) + 1
    dim = int(lado**2 * (n + 1)**2 + 2 * (n + 1) * lado + 1)
    # Initialize vectors
    Culture_vector = np.zeros(dim, dtype=np.int8)
    # Get live cell indices in the Culture_aux grid
    live_cells = np.where(Culture_aux.ravel() == SystemConst.MEMBRANE)[0]
    if len(live_cells) == 0:
        return np.zeros(dim, dtype=np.int8)
    
    # === MEMBRANE TILES (value=1) ===
    # Generate all membrane tile indices for all live cells at once
    # For each live cell, generate its n×n interior tiles
    # Cell occupies positions: [cell_base + i*side + j] for i,j in 1..n
    i_offsets = np.arange(1, n + 1)[:, None, None]  # (n, 1, 1)
    j_offsets = np.arange(1, n + 1)[None, :, None]  # (1, n, 1)
    cell_indices = live_cells[None, None, :]         # (1, 1, num_live)    
    # Compute row and column of each cell in the culture grid
    cell_row = cell_indices // lado
    cell_col = cell_indices % lado
    # Base index for each cell in the full simulation grid
    cell_base = cell_indices * (n + 1) + cell_row * (side * n + 1)
    # Add i,j offsets to get all interior tiles
    all_membrane_indices = cell_base + i_offsets * side + j_offsets
    Culture_vector[all_membrane_indices.ravel()] = SystemConst.MEMBRANE

    # === Apoptotic TILES (value=1) ===
    for apo in SystemConst.APOTOSIS:
        # Generate all membrane tile indices for all live cells at once
        # For each apoptotic cell, generate its reduced n×n interior tiles
        if apo != 0:
            center = (n + 1) // 2
            half_w = int((n + 1) * (1 - 2/apo) / 2)
            i_offsets = np.arange(center - half_w, center + half_w + 1)[:, None, None]  # (n, 1, 1)
            j_offsets = np.arange(center - half_w, center + half_w + 1)[None, :, None]  # (1, n, 1)
            apo_cells = np.where(Culture_aux.ravel() == apo)[0]
            cell_indices = apo_cells[None, None, :]            
            # Compute row and column of each cell in the culture grid
            cell_row = cell_indices // lado
            # Base index for each cell in the full simulation grid
            cell_base = cell_indices * (n + 1) + cell_row * (side * n + 1)
            # Add i,j offsets to get all interior tiles
            all_membrane_indices = cell_base + i_offsets * side + j_offsets
            # Flatten and set membrane tiles
            membrane_flat = all_membrane_indices.ravel()
            Culture_vector[membrane_flat] = SystemConst.MEMBRANE
    
    # === INTERCELLULAR JUNCTIONS (Rb, value=8) ===
    # Cells with living neighbors have Rb tiles at their borders
    # Use convolution to detect neighbors efficiently
    Culture_2d = Culture_aux.reshape(lado, lado).astype(float) # Reshape for 2D convolution
    
    neighbor_kernel = np.array([
        [0, 1, 0],                  # Convolution kernel to detect neighbors (4-connectivity)
        [1, 0, 1],                  # [0, 1, 0]
        [0, 1, 0]                   # [1, 0, 1]  <- detects if any neighbor is alive
    ], dtype=float)                 # [0, 1, 0]
    # Convolve to count living neighbors
    # neighbor_count[i,j] = number of living neighbors of cell (i,j)
    neighbor_count = convolve(Culture_2d, neighbor_kernel, mode='constant', cval=0)
    # Cells that are alive AND have at least one alive neighbor get Rb tiles
    has_neighbor = (Culture_2d == SystemConst.MEMBRANE) & (neighbor_count > 0)
    cells_with_rb = np.where(has_neighbor.ravel())[0]
    if len(cells_with_rb) > 0:
        # For each cell with neighbors, add Rb tiles at borders
        # Rb tiles form a single-tile border around the n×n interior
        Rb_indices = _compute_rb_indices_vectorized(
            cells_with_rb, lado, n, side, Culture_2d
        )
        if len(Rb_indices) > 0:
            Culture_vector[Rb_indices] = SystemConst.TJ
    
    return Culture_vector

def _compute_rb_indices_vectorized(
    cells_with_neighbors: np.ndarray,
    lado: int,
    n: int,
    side: int,
    Culture_2d: np.ndarray
) -> np.ndarray:
    """
    Compute Rb (intercellular junction) tile indices.
    For each cell, check each of 4 directions (up, down, left, right)
    to see if there's a living neighbor. If yes, add Rb tiles on that border.
    """
    #num_cells = len(cells_with_neighbors)
    # Compute cell positions in grid
    cell_rows = cells_with_neighbors // lado
    cell_cols = cells_with_neighbors % lado
    # Base indices for each cell in simulation grid
    cell_bases = (
        cells_with_neighbors * (n + 1) + 
        cell_rows * (side * n + 1))
    
    # Pre-allocate Rb indices list (we'll collect then concatenate)
    rb_indices_list = []
    
    # === RIGHT NEIGHBOR ===
    # Check if cell to the right exists and is alive
    has_right = (cell_cols < lado - 1)  # Not at right edge
    if np.any(has_right):
        #right_cells = cells_with_neighbors[has_right]
        right_rows = cell_rows[has_right]
        right_cols = cell_cols[has_right]
        
        # Check if right neighbor is alive
        right_neighbor_alive = Culture_2d[right_rows, right_cols + 1] == SystemConst.MEMBRANE
        
        if np.any(right_neighbor_alive):
            # Add right border tiles for these cells
            valid_cells = cell_bases[has_right][right_neighbor_alive]
            
            # Right border: column (n+1), rows 0..(n+1)
            i_range = np.arange(n + 2)[:, None]
            rb_right = valid_cells[None, :] + i_range * side + (n + 1)
            rb_indices_list.append(rb_right.ravel())
    is_right = (cell_cols == lado - 1) 
    if np.any(is_right):
        valid_cells = cell_bases[is_right]

        i_range = np.arange(n + 2)[:, None]
        rb_right = valid_cells[None, :] + i_range * side + (n + 1)
        rb_indices_list.append(rb_right.ravel())
    
    # === LEFT NEIGHBOR ===
    has_left = (cell_cols > 0)
    if np.any(has_left):
        #left_cells = cells_with_neighbors[has_left]
        left_rows = cell_rows[has_left]
        left_cols = cell_cols[has_left]
        
        left_neighbor_alive = Culture_2d[left_rows, left_cols - 1] == SystemConst.MEMBRANE
    
        if np.any(left_neighbor_alive):
            valid_cells = cell_bases[has_left][left_neighbor_alive]
            i_range = np.arange(n + 2)[:, None]
            rb_left = valid_cells[None, :] + i_range * side + 0
            rb_indices_list.append(rb_left.ravel())
    
    is_left = (cell_cols == 0)
    if np.any(is_left):
        valid_cells = cell_bases[is_left]
        i_range = np.arange(n + 2)[:, None]
        rb_left = valid_cells[None, :] + i_range * side + 0
        rb_indices_list.append(rb_left.ravel())

    # === BOTTOM NEIGHBOR (higher row number) ===
    has_bottom = (cell_rows < lado - 1)
    if np.any(has_bottom):
        #bottom_cells = cells_with_neighbors[has_bottom]
        bottom_rows = cell_rows[has_bottom]
        bottom_cols = cell_cols[has_bottom]
        
        bottom_neighbor_alive = Culture_2d[bottom_rows + 1, bottom_cols] == SystemConst.MEMBRANE
        
        if np.any(bottom_neighbor_alive):
            valid_cells = cell_bases[has_bottom][bottom_neighbor_alive]
            j_range = np.arange(n + 2)[None, :]
            rb_bottom = valid_cells[:, None] + (n + 1) * side + j_range
            rb_indices_list.append(rb_bottom.ravel())
    
    is_bottom = (cell_rows == lado - 1)
    if np.any(is_bottom):
        valid_cells = cell_bases[is_bottom]
        j_range = np.arange(n + 2)[None, :]
        rb_bottom = valid_cells[:, None] + (n + 1) * side + j_range
        rb_indices_list.append(rb_bottom.ravel())

    # === TOP NEIGHBOR (lower row number) ===
    has_top = (cell_rows > 0)
    if np.any(has_top):
        top_cells = cells_with_neighbors[has_top]
        top_rows = cell_rows[has_top]
        top_cols = cell_cols[has_top]
        
        top_neighbor_alive = Culture_2d[top_rows - 1, top_cols] == SystemConst.MEMBRANE
        
        if np.any(top_neighbor_alive):
            valid_cells = cell_bases[has_top][top_neighbor_alive]
            j_range = np.arange(n + 2)[None, :]
            rb_top = valid_cells[:, None] + 0 * side + j_range
            rb_indices_list.append(rb_top.ravel())
    
    is_top = (cell_rows == 0)
    if np.any(is_top):
        valid_cells = cell_bases[is_top]
        j_range = np.arange(n + 2)[None, :]
        rb_top = valid_cells[:, None] + 0 * side + j_range
        rb_indices_list.append(rb_top.ravel())

    # Concatenate all Rb indices and remove duplicates
    if rb_indices_list:
        all_rb_indices = np.concatenate(rb_indices_list)
        return np.unique(all_rb_indices)
    else:
        return np.array([], dtype=int)

def construct_substrate_vectorized(
    lado: int,
    n: int,
    de: float,  # Electrode diameter [cm]
    l: float    # Cell side length [cm]
) -> np.ndarray:
    """
    Substrate construction.
    Args:
        lado: Number of cells per side
        n: Subcellular resolution
        de: Electrode diameter [cm]
        l: Cell side length (sqrt of cell area) [cm]
    Returns:
        Substrate_vector: Flattened array with 1=electrode, 0=insulator
    """
    side = lado * (n + 1) + 1
    d = lado * l / side  # Tile size
    
    # Generate coordinate arrays for all tiles
    x_coords = np.arange(side) * d
    y_coords = np.arange(side) * d
    
    # Center of electrode
    x_center = lado * l / 2
    y_center = lado * l / 2
    
    # Distance of each tile from center (using broadcasting)
    X, Y = np.meshgrid(x_coords, y_coords, indexing='ij')
    dist_sq = (X - x_center)**2 + (Y - y_center)**2
    
    # Electrode region: distance < radius
    electrode_radius = de / 2
    Substrate = (dist_sq <= electrode_radius**2).astype(np.int8)
    
    # Flatten in Fortran order (column-major) to match original
    Substrate_vector = Substrate.ravel(order='F')
    
    return Substrate_vector
