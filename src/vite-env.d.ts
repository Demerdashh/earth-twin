/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'mock' (default) or 'real' — see src/config/data-source.ts */
  readonly VITE_DATA_SOURCE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
