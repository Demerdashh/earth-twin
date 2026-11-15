/**
 * Story mode content — edit text here, no other file needs to change. Keep it short:
 * one headline and at most one line per chapter; the globe does the talking.
 *
 * Text tokens (filled from the loaded data set, so numbers are never hard-coded):
 *   {{target:<id>:name}}               target name
 *   {{target:<id>:<feature>}}          target fingerprint value with unit, e.g. {{target:shackleton_rim:slope_deg}}
 *   {{count:candidates}}               number of Earth candidates
 *   {{top:<target id>}}                best-ranked candidate that is NOT a known analog (default weights)
 * Widgets render small data-driven blocks under the text.
 */
import type { Body } from '../contract/types';
import type { LayerId } from '../app/state';

export type StoryWidget = 'fingerprint' | 'validation' | 'discovery' | 'limits' | 'cta';

export interface Chapter {
  id: string;
  kicker: string;
  title: string;
  /** At most one short line. */
  line?: string;
  body: Body;
  targetId: string;
  camera: { lon: number; lat: number; height: number };
  /** Layers switched on for this chapter (others off). */
  layers: LayerId[];
  /** Sweep the translucent scan band over the globe (Earth only). */
  scan?: boolean;
  widgets?: StoryWidget[];
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'hook',
    kicker: 'Analog Finder',
    title: 'Where on Earth is the Moon?',
    line: 'Places on our planet that resemble the Moon and Mars.',
    body: 'moon',
    targetId: 'shackleton_rim',
    camera: { lon: 129.78, lat: -62, height: 5_200_000 },
    layers: ['base'],
  },
  {
    id: 'problem',
    kicker: '01',
    title: 'Different worlds. Same questions.',
    line: 'Slope, heat, minerals, ice — measured from orbit.',
    body: 'mars',
    targetId: 'jezero',
    camera: { lon: 77.58, lat: 18.38, height: 4_200_000 },
    layers: ['base', 'markers'],
    widgets: ['limits'],
  },
  {
    id: 'fingerprint',
    kicker: '02',
    title: 'Every site has a fingerprint.',
    body: 'moon',
    targetId: 'shackleton_rim',
    camera: { lon: 129.78, lat: -74, height: 1_900_000 },
    layers: ['base', 'markers'],
    widgets: ['fingerprint'],
  },
  {
    id: 'search',
    kicker: '03',
    title: 'Then we scan the Earth.',
    line: '{{count:candidates}} candidate sites. Forests filtered out.',
    body: 'earth',
    targetId: 'shackleton_rim',
    camera: { lon: -30, lat: 12, height: 20_000_000 },
    layers: ['base', 'similarity', 'markers'],
    scan: true,
  },
  {
    id: 'trust',
    kicker: '04',
    title: 'Does it find what NASA already uses?',
    body: 'earth',
    targetId: 'jezero',
    camera: { lon: -75, lat: 5, height: 15_000_000 },
    layers: ['base', 'similarity', 'markers'],
    widgets: ['validation'],
  },
  {
    id: 'discovery',
    kicker: '05',
    title: 'And maybe somewhere new.',
    body: 'earth',
    targetId: 'jezero',
    camera: { lon: 28, lat: 24, height: 5_500_000 },
    layers: ['base', 'similarity', 'markers'],
    widgets: ['discovery'],
  },
  {
    id: 'your-turn',
    kicker: '06',
    title: 'Your turn.',
    line: 'Change what matters. Watch the answer move.',
    body: 'earth',
    targetId: 'shackleton_rim',
    camera: { lon: 10, lat: 20, height: 21_000_000 },
    layers: ['base', 'similarity', 'markers'],
    widgets: ['cta'],
  },
];
