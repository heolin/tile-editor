/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Open every board in both ladders, for playing a batch through without
   * clearing the one before it first. On by default in a dev server; set it to
   * `true` to get the same in a build, or to `false` to put the ladder back.
   */
  readonly VITE_SOKOBAN_UNLOCK_ALL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
