import { dataDir, type DataSource } from '../config/data-source';
import { validateDataSet, type DataReader, type ValidationResult } from './validate';

const TIMEOUT_MS = 15_000;

async function fetchOk(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError')
      throw new Error(`timed out loading ${url}`, { cause: err });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function fetchReader(baseUrl: string): DataReader {
  return {
    baseUrl,
    json: async (name) => {
      const res = await fetchOk(baseUrl + name);
      try {
        return (await res.json()) as unknown;
      } catch {
        throw new Error('file is not valid JSON');
      }
    },
    head: async (name, bytes) => new Uint8Array(await (await fetchOk(baseUrl + name)).arrayBuffer()).slice(0, bytes),
  };
}

export const dataBaseUrl = (source: DataSource): string => `${import.meta.env.BASE_URL}${dataDir(source)}`;

/** Load and validate the whole data set for a source. Invalid data is never returned. */
export function loadDataSet(source: DataSource): Promise<ValidationResult> {
  return validateDataSet(fetchReader(dataBaseUrl(source)));
}
