import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {createRequire} from 'node:module';
const {checkoutPaths}=createRequire(import.meta.url)('../est-common/transient-paths.cjs');
const paths=checkoutPaths();

export default defineConfig({
    root:import.meta.dirname,cacheDir:paths.directory('est-gui','cache','vite-web'),
    // Linked CommonJS contracts change in place without a lockfile/version bump.
    optimizeDeps: { include: ["@effectstreamer/common"], force: true },
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": resolve(import.meta.dirname, "src/renderer/windowMain"), "@runtime-platform": resolve(import.meta.dirname, "src/renderer/windowMain/runtime/browser.js") } },
    build: { outDir: paths.directory('est-gui','web'), emptyOutDir:true, commonjsOptions: { include: [/node_modules/, /est-common/] } }
});
