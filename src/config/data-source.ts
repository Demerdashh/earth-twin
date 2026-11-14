/**
 * THE switch between mock and real data. No other code changes are needed to go real:
 *   1. drop contract-valid files into public/data/  (validate: npm run validate:data -- public/data)
 *   2. set VITE_DATA_SOURCE=real (e.g. `VITE_DATA_SOURCE=real npm run build`) or change the default below.
 * A `?data=mock|real` query parameter overrides it at runtime (handy for demos and tests).
 */
export type DataSource = 'mock' | 'real';

const DEFAULT_DATA_SOURCE: DataSource = 'mock';

function parse(value: unknown): DataSource | null {
  return value === 'mock' || value === 'real' ? value : null;
}

export function resolveDataSource(search: string = typeof location === 'undefined' ? '' : location.search): DataSource {
  const fromQuery = parse(new URLSearchParams(search).get('data'));
  const fromEnv = parse(import.meta.env.VITE_DATA_SOURCE);
  return fromQuery ?? fromEnv ?? DEFAULT_DATA_SOURCE;
}

/** Directory (relative to the site base) holding the contract files for a source. */
export const dataDir = (source: DataSource): string => (source === 'mock' ? 'data/mock/' : 'data/');
