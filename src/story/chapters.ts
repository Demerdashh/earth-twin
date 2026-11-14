/**
 * Story mode content — edit text here, no other file needs to change.
 *
 * Text tokens (filled from the loaded data set, so numbers are never hard-coded):
 *   {{target:<id>:name}}               target name
 *   {{target:<id>:<feature>}}          target fingerprint value with unit, e.g. {{target:shackleton_rim:slope_deg}}
 *   {{count:candidates}}               number of Earth candidates
 *   {{top:<target id>}}                best-ranked candidate that is NOT a known analog (default weights)
 * Widgets render data-driven blocks under the text.
 */
import type { Body } from '../contract/types';
import type { LayerId } from '../app/state';

export type StoryWidget = 'fingerprint' | 'validation' | 'discovery' | 'limits' | 'cta';

export interface Chapter {
  id: string;
  kicker: string;
  title: string;
  paragraphs: string[];
  body: Body;
  targetId: string;
  camera: { lon: number; lat: number; height: number };
  /** Layers switched on for this chapter (others off). */
  layers: LayerId[];
  widgets?: StoryWidget[];
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'hook',
    kicker: '01 · The question',
    title: 'Where on Earth is the Moon?',
    paragraphs: [
      'Before astronauts walk the rim of {{target:shackleton_rim:name}}, they will rehearse somewhere on Earth.',
      'Picking that place is a data problem: which terrain on our planet looks, feels and behaves most like the target?',
    ],
    body: 'moon',
    targetId: 'shackleton_rim',
    camera: { lon: 129.78, lat: -80, height: 2_600_000 },
    layers: ['base', 'markers'],
  },
  {
    id: 'problem',
    kicker: '02 · The problem',
    title: 'Different worlds, same questions',
    paragraphs: [
      'Mars rovers and landers are tested in deserts, lava fields and polar valleys. But "looks similar" is not a measurement.',
      'We compare what can be measured from orbit on both bodies: slope, roughness, the daily temperature swing, mineralogy and signs of water or ice.',
    ],
    body: 'mars',
    targetId: 'jezero',
    camera: { lon: 77.58, lat: 18.38, height: 3_500_000 },
    layers: ['base', 'markers', 'water_ice'],
    widgets: ['limits'],
  },
  {
    id: 'fingerprint',
    kicker: '03 · The fingerprint',
    title: 'A site, reduced to numbers',
    paragraphs: [
      'Inside a {{target:shackleton_rim:radius_km}} radius around the target, we average each feature into a fingerprint.',
      'Slope {{target:shackleton_rim:slope_deg}}, thermal range {{target:shackleton_rim:temp_range_k}}, mafic index {{target:shackleton_rim:mineral_index}}. Every value stays in physical units: degrees, kelvin, metres.',
    ],
    body: 'moon',
    targetId: 'shackleton_rim',
    camera: { lon: 129.78, lat: -86, height: 900_000 },
    layers: ['base', 'markers', 'water_ice'],
    widgets: ['fingerprint'],
  },
  {
    id: 'search',
    kicker: '04 · The search',
    title: 'Scanning a whole planet',
    paragraphs: [
      'We compare that fingerprint against {{count:candidates}} candidate sites on Earth and colour every land cell by similarity.',
      'Vegetated places are filtered out: a forest is never a good stand-in for the Moon.',
    ],
    body: 'earth',
    targetId: 'shackleton_rim',
    camera: { lon: 0, lat: 15, height: 21_000_000 },
    layers: ['base', 'similarity', 'markers'],
  },
  {
    id: 'trust',
    kicker: '05 · Trust',
    title: 'Does it find the places NASA already uses?',
    paragraphs: [
      'A method is only useful if it rediscovers known analogs: Atacama, Haughton Crater, Mauna Kea, Iceland, the San Francisco Volcanic Field and the Dry Valleys.',
      'Here is where each one lands in the ranking.',
    ],
    body: 'earth',
    targetId: 'jezero',
    camera: { lon: -60, lat: 10, height: 17_000_000 },
    layers: ['base', 'similarity', 'markers'],
    widgets: ['validation'],
  },
  {
    id: 'discovery',
    kicker: '06 · Discovery',
    title: 'Something we did not expect?',
    paragraphs: ['The best-ranked site that is not on the known list for {{target:jezero:name}} is {{top:jezero}}.'],
    body: 'earth',
    targetId: 'jezero',
    camera: { lon: 25, lat: 25, height: 6_000_000 },
    layers: ['base', 'similarity', 'markers'],
    widgets: ['discovery'],
  },
  {
    id: 'your-turn',
    kicker: '07 · Your turn',
    title: 'Change the weights. Change the answer.',
    paragraphs: [
      'Care more about slopes than temperature? Planning a rover test rather than a habitat? Open Explore mode, move the sliders and watch the ranking reorder.',
    ],
    body: 'earth',
    targetId: 'shackleton_rim',
    camera: { lon: 10, lat: 20, height: 22_000_000 },
    layers: ['base', 'similarity', 'markers'],
    widgets: ['cta'],
  },
];
