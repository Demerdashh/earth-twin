import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pngSize, schemaErrors, validateDataSet, type DataReader } from '../../src/data/validate';

const dir = new URL('../../public/data/mock/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, dir), 'utf8');

/** Reader over the committed mock set, with optional per-file overrides. */
function reader(
  overrides: Record<string, (doc: Record<string, unknown>) => unknown> = {},
  bytes: Record<string, Uint8Array> = {},
): DataReader {
  return {
    baseUrl: 'mock://',
    json: (name) => {
      const doc = JSON.parse(read(name)) as Record<string, unknown>;
      const fn = overrides[name];
      return Promise.resolve(fn ? fn(doc) : doc);
    },
    head: (name, n) => Promise.resolve((bytes[name] ?? new Uint8Array(readFileSync(new URL(name, dir)))).slice(0, n)),
  };
}

describe('validateDataSet', () => {
  it('accepts the committed mock set', async () => {
    const r = await validateDataSet(reader());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.mock).toBe(true);
      expect(new Set(r.data.targets.targets.map((t) => t.body))).toEqual(new Set(['moon', 'mars']));
    }
  });

  it('reports schema errors with file and JSON path', async () => {
    const r = await validateDataSet(
      reader({
        'targets.json': (d) => {
          (d.targets as { features: Record<string, number> }[])[0]!.features.slope_deg = 120;
          return d;
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toContainEqual(
        expect.objectContaining({ file: 'targets.json', path: expect.stringContaining('slope_deg') as unknown }),
      );
  });

  it('rejects mixing mock and real files', async () => {
    const r = await validateDataSet(reader({ 'earth_candidates.json': (d) => ({ ...d, mock: false }) }));
    expect(!r.ok && r.errors.some((e) => e.message.includes('do not mix mock and real'))).toBe(true);
  });

  it('requires a note on mock files', async () => {
    const r = await validateDataSet(reader({ 'provenance.json': ({ note: _note, ...rest }) => rest }));
    expect(r.ok).toBe(false);
  });

  it('rejects broken PNGs and dangling ids', async () => {
    const r = await validateDataSet(
      reader(
        { 'earth_candidates.json': (d) => ({ ...d, per_target: { ...(d.per_target as object), jezero: ['nope'] } }) },
        { 'similarity_jezero.png': new TextEncoder().encode('not a png at all, definitely') },
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.message.includes('not a valid PNG'))).toBe(true);
      expect(r.errors.some((e) => e.message.includes('unknown candidates'))).toBe(true);
    }
  });
});

describe('helpers', () => {
  it('reads PNG dimensions', () => {
    expect(pngSize(new Uint8Array(readFileSync(new URL('similarity_jezero.png', dir))))).toEqual({
      width: 360,
      height: 180,
    });
  });
  it('validates a single document by kind', () => {
    expect(schemaErrors('known_analogs', 'x', JSON.parse(read('known_analogs.json')))).toEqual([]);
    expect(schemaErrors('known_analogs', 'x', { schema_version: '1.0' }).length).toBeGreaterThan(0);
  });
});
