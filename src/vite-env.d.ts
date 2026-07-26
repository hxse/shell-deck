/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHELL_DECK_DEV_BACKEND_PORT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
