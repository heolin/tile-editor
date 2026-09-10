import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The Android build is a native shell around the same web app. It deliberately
 * does not try to read the filesystem itself: Android's storage permissions are
 * a maze, and the project already has a server that does this well. The app
 * connects to that server over localhost - the one running in Termux - which is
 * why cleartext to loopback has to be allowed.
 *
 * The server refuses cross-origin calls unless told otherwise, so it has to be
 * started with --app for this shell to reach it.
 */
const config: CapacitorConfig = {
  appId: 'dev.tileeditor.app',
  appName: 'tile-editor',
  webDir: 'packages/ui/dist',
  android: {
    allowMixedContent: true,
  },
  server: {
    // Serves the shell from http://localhost, which is an origin --app allows.
    androidScheme: 'http',
    cleartext: true,
  },
}

export default config
