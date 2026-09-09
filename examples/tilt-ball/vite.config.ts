import { defineConfig } from 'vite';
import { sharedServerConfig, sharedResolve } from '../../scripts/vite-shared.mjs';

export default defineConfig({
  server: sharedServerConfig(5190),
  resolve: sharedResolve,
});
