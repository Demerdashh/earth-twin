// Contract validator shared by the browser (loader.ts) and Node (tools/scripts/validate-data.ts).
// Mirrors pipeline/validate_contract.py: JSON Schema per file + PNG checks + cross-file rules.
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import analogsSchema from '../../schemas/analogs.schema.json';
import commonSchema from '../../schemas/common.schema.json';
import candidatesSchema from '../../schemas/earth_candidates.schema.json';
import gridSchema from '../../schemas/grid.schema.json';
import knownSchema from '../../schemas/known_analogs.schema.json';
import manifestSchema from '../../schemas/manifest.schema.json';
import provenanceSchema from '../../schemas/provenance.schema.json';
import targetsSchema from '../../schemas/targets.schema.json';
import validationSchema from '../../schemas/validation_report.schema.json';
import type {
  AnalogsFile,
  Body,
  DataSet,
  EarthCandidatesFile,
  GridFile,
  KnownAnalogsFile,
  ManifestFile,
  ProvenanceFile,
  TargetsFile,
  ValidationReportFile,
} from '../contract/types';

export type SchemaKind =
  | 'manifest'
  | 'targets'
  | 'earth_candidates'
  | 'analogs'
  | 'provenance'
  | 'known_analogs'
  | 'validation_report'
  | 'grid';

export interface ContractError {
  file: string;
  path: string;
  message: string;
}

/** Abstracts where files come from (fetch in the browser, fs in Node). */
export interface DataReader {
  baseUrl: string;
  json(name: string): Promise<unknown>;
  /** First bytes of a binary file (enough for the PNG header). */
  head(name: string, bytes: number): Promise<Uint8Array>;
}

const SCHEMAS: Record<SchemaKind, object> = {
  manifest: manifestSchema,
  targets: targetsSchema,
  earth_candidates: candidatesSchema,
  analogs: analogsSchema,
  provenance: provenanceSchema,
  known_analogs: knownSchema,
  validation_report: validationSchema,
  grid: gridSchema,
};

let compiled: Record<SchemaKind, ValidateFunction> | null = null;
function validators(): Record<SchemaKind, ValidateFunction> {
  if (compiled) return compiled;
  // Formats (date-time, uri) are annotations only — same behaviour as the Python validator.
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  ajv.addSchema(commonSchema);
  const out = {} as Record<SchemaKind, ValidateFunction>;
  for (const [kind, schema] of Object.entries(SCHEMAS) as [SchemaKind, object][]) {
    out[kind] = ajv.compile(schema);
  }
  compiled = out;
  return out;
}

const fmt = (file: string, e: ErrorObject): ContractError => ({
  file,
  path: `$${e.instancePath.replace(/\//g, '.')}`,
  message: `${e.message ?? 'invalid'}${'allowedValues' in e.params ? ` (${(e.params.allowedValues as unknown[]).join(', ')})` : ''}`,
});

export function schemaErrors(kind: SchemaKind, file: string, doc: unknown): ContractError[] {
  const v = validators()[kind];
  return v(doc) ? [] : (v.errors ?? []).map((e) => fmt(file, e));
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIG.some((b, i) => bytes[i] !== b)) return null;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

export type ValidationResult = { ok: true; data: DataSet } | { ok: false; errors: ContractError[] };

export async function validateDataSet(reader: DataReader): Promise<ValidationResult> {
  const errors: ContractError[] = [];
  const push = (file: string, message: string, path = '$'): void => {
    errors.push({ file, path, message });
  };

  async function load<T>(kind: SchemaKind, file: string): Promise<T | null> {
    let doc: unknown;
    try {
      doc = await reader.json(file);
    } catch (err) {
      push(file, `could not load: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    const errs = schemaErrors(kind, file, doc);
    errors.push(...errs);
    return errs.length ? null : (doc as T);
  }

  const manifest = await load<ManifestFile>('manifest', 'manifest.json');
  if (!manifest) return { ok: false, errors };

  const f = manifest.files;
  const [targets, candidates, provenance, knownAnalogs, validation] = await Promise.all([
    load<TargetsFile>('targets', f.targets),
    load<EarthCandidatesFile>('earth_candidates', f.earth_candidates),
    load<ProvenanceFile>('provenance', f.provenance),
    load<KnownAnalogsFile>('known_analogs', f.known_analogs),
    load<ValidationReportFile>('validation_report', f.validation_report),
  ]);
  for (const [name, doc] of Object.entries({
    [f.targets]: targets,
    [f.earth_candidates]: candidates,
    [f.provenance]: provenance,
    [f.known_analogs]: knownAnalogs,
    [f.validation_report]: validation,
  })) {
    if (doc && doc.mock !== manifest.mock) {
      push(
        name,
        `mock=${String(doc.mock)} but manifest mock=${String(manifest.mock)} (do not mix mock and real files)`,
        '$.mock',
      );
    }
  }

  const analogs: Record<string, AnalogsFile> = {};
  await Promise.all(
    Object.entries(manifest.analogs).map(async ([tid, file]) => {
      const doc = await load<AnalogsFile>('analogs', file);
      if (!doc) return;
      if (doc.target_id !== tid)
        push(file, `target_id '${doc.target_id}' does not match manifest key '${tid}'`, '$.target_id');
      analogs[tid] = doc;
    }),
  );

  const grids: Partial<Record<Body, GridFile>> = {};
  await Promise.all(
    (Object.entries(manifest.grids) as [Body, string][]).map(async ([body, file]) => {
      const doc = await load<GridFile>('grid', file);
      if (!doc) return;
      if (doc.body !== body) push(file, `body '${doc.body}' does not match manifest key '${body}'`, '$.body');
      const width = 2 + doc.columns.length;
      const bad = doc.cells.findIndex((c) => c.length !== width);
      if (bad >= 0) push(file, `cell has ${doc.cells[bad]?.length} values, expected ${width}`, `$.cells[${bad}]`);
      grids[body] = doc;
    }),
  );

  await Promise.all(
    manifest.overlays.map(async (ov) => {
      try {
        const size = pngSize(await reader.head(ov.file, 24));
        if (!size) push(ov.file, 'not a valid PNG file');
        else if (size.width !== ov.width || size.height !== ov.height)
          push(ov.file, `PNG is ${size.width}x${size.height} but manifest says ${ov.width}x${ov.height}`);
      } catch (err) {
        push(
          ov.file,
          `overlay listed in manifest could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

  // Cross-file rules
  const targetIds = new Set(targets?.targets.map((t) => t.id) ?? []);
  const provIds = new Set(provenance?.datasets.map((d) => d.id) ?? []);
  const knownIds = new Set(knownAnalogs?.analogs.map((a) => a.id) ?? []);
  if (candidates) {
    const candIds = new Set(candidates.candidates.map((c) => c.id));
    if (candIds.size !== candidates.candidates.length)
      push(f.earth_candidates, 'duplicate candidate ids', '$.candidates');
    for (const [tid, pool] of Object.entries(candidates.per_target)) {
      if (targets && !targetIds.has(tid))
        push(f.earth_candidates, `per_target key '${tid}' is not a target in ${f.targets}`, `$.per_target.${tid}`);
      const missing = pool.filter((id) => !candIds.has(id));
      if (missing.length)
        push(
          f.earth_candidates,
          `per_target['${tid}'] references unknown candidates ${missing.slice(0, 5).join(', ')}`,
          `$.per_target.${tid}`,
        );
    }
    candidates.candidates.forEach((c, i) => {
      if (c.known_analog_id && knownAnalogs && !knownIds.has(c.known_analog_id))
        push(
          f.earth_candidates,
          `known_analog_id '${c.known_analog_id}' not in ${f.known_analogs}`,
          `$.candidates[${i}].known_analog_id`,
        );
      for (const [feat, pid] of Object.entries(c.provenance)) {
        if (provenance && !provIds.has(pid))
          push(
            f.earth_candidates,
            `provenance '${pid}' not in ${f.provenance}`,
            `$.candidates[${i}].provenance.${feat}`,
          );
      }
    });
    for (const tid of targetIds) {
      if (!(tid in candidates.per_target))
        push(f.earth_candidates, `per_target has no pool for target '${tid}'`, '$.per_target');
    }
  }
  targets?.targets.forEach((t, i) => {
    for (const [feat, pid] of Object.entries(t.provenance)) {
      if (provenance && !provIds.has(pid))
        push(f.targets, `provenance '${pid}' not in ${f.provenance}`, `$.targets[${i}].provenance.${feat}`);
    }
  });
  for (const tid of Object.keys(manifest.analogs)) {
    if (targets && !targetIds.has(tid))
      push('manifest.json', `analogs key '${tid}' is not a target`, `$.analogs.${tid}`);
  }
  manifest.overlays.forEach((ov, i) => {
    if (ov.target_id && targets && !targetIds.has(ov.target_id))
      push('manifest.json', `overlay target_id '${ov.target_id}' unknown`, `$.overlays[${i}].target_id`);
    for (const pid of ov.provenance_ids) {
      if (provenance && !provIds.has(pid))
        push('manifest.json', `provenance '${pid}' not in ${f.provenance}`, `$.overlays[${i}].provenance_ids`);
    }
  });

  if (errors.length || !targets || !candidates || !provenance || !knownAnalogs || !validation) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: {
      baseUrl: reader.baseUrl,
      mock: manifest.mock,
      manifest,
      targets,
      candidates,
      provenance,
      knownAnalogs,
      validation,
      analogs,
      grids,
    },
  };
}
