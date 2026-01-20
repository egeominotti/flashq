/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FLASHQ_API_URL: string;
  readonly VITE_FLASHQ_AUTH_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
