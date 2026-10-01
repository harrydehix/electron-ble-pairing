import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import electron from "vite-plugin-electron/simple";

/**
 * Vite config that builds three targets:
 *  - the Vue renderer (regular Vite app)
 *  - the Electron main process  -> dist-electron/main.js
 *  - the Electron preload script -> dist-electron/preload.mjs
 *
 * `vite-plugin-electron/simple` also starts/restarts Electron during `vite` dev.
 */
export default defineConfig({
    plugins: [
        vue(),
        electron({
            main: {
                entry: "electron/main.ts",
            },
            preload: {
                input: "electron/preload.ts",
            },
        }),
    ],
});
