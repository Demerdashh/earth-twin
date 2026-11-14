import type { EarthFeature, GridFile } from '../contract/types';

export interface GridSample {
  row: number;
  col: number;
  /** Cell centre in degrees. */
  lat: number;
  lon: number;
  values: Partial<Record<EarthFeature, number | null>>;
}

const indexCache = new WeakMap<GridFile, Map<number, (number | null)[]>>();

function index(grid: GridFile): Map<number, (number | null)[]> {
  let idx = indexCache.get(grid);
  if (!idx) {
    idx = new Map();
    const ncols = Math.round(360 / grid.step_deg);
    for (const cell of grid.cells) idx.set((cell[0] ?? 0) * ncols + (cell[1] ?? 0), cell);
    indexCache.set(grid, idx);
  }
  return idx;
}

/** Look up the grid cell containing (lat, lon); null when the grid has no data there. */
export function sampleGrid(grid: GridFile, lat: number, lon: number): GridSample | null {
  const step = grid.step_deg;
  const nrows = Math.round(180 / step);
  const ncols = Math.round(360 / step);
  const row = Math.min(nrows - 1, Math.max(0, Math.floor((lat + 90) / step)));
  const lonN = ((((lon + 180) % 360) + 360) % 360) - 180;
  const col = Math.min(ncols - 1, Math.max(0, Math.floor((lonN + 180) / step)));
  const cell = index(grid).get(row * ncols + col);
  if (!cell) return null;
  const values: Partial<Record<EarthFeature, number | null>> = {};
  grid.columns.forEach((name, i) => {
    values[name] = cell[i + 2] ?? null;
  });
  if (Object.values(values).every((v) => v == null)) return null;
  return { row, col, lat: -90 + (row + 0.5) * step, lon: -180 + (col + 0.5) * step, values };
}
