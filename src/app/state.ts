import type { Body, Weights } from '../contract/types';

export type Mode = 'story' | 'explore' | 'methods';
export type LayerId = 'base' | 'similarity' | 'vegetation' | 'water_ice' | 'markers';
export const LAYER_IDS: readonly LayerId[] = ['base', 'similarity', 'vegetation', 'water_ice', 'markers'];

export interface LayerState {
  visible: boolean;
  opacity: number;
}

export type Selection =
  | { kind: 'candidate'; id: string }
  | { kind: 'target'; id: string }
  | { kind: 'point'; body: Body; lat: number; lon: number };

export interface AppState {
  mode: Mode;
  body: Body;
  targetId: string;
  weights: Weights;
  layers: Record<LayerId, LayerState>;
  isolate: LayerId | null;
  baseSource: Partial<Record<Body, string>>;
  selection: Selection | null;
}

type Listener = (state: AppState, prev: AppState) => void;

export class Store {
  private listeners = new Set<Listener>();
  constructor(private state: AppState) {}

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const l of this.listeners) l(this.state, prev);
  }

  setLayer(id: LayerId, patch: Partial<LayerState>): void {
    this.set({ layers: { ...this.state.layers, [id]: { ...this.state.layers[id], ...patch } } });
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const DEFAULT_LAYERS: Record<LayerId, LayerState> = {
  base: { visible: true, opacity: 1 },
  similarity: { visible: true, opacity: 0.85 },
  vegetation: { visible: false, opacity: 0.7 },
  water_ice: { visible: false, opacity: 0.8 },
  markers: { visible: true, opacity: 1 },
};
