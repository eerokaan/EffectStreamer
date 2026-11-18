import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {createRequire} from 'node:module';
const {checkoutPaths}=createRequire(import.meta.url)('../common/transient-paths.cjs');
const paths=checkoutPaths();
const renderer=resolve(import.meta.dirname, 'src/renderer/windowMain');

export default defineConfig({
    root:resolve(import.meta.dirname, 'src/web'), publicDir:resolve(import.meta.dirname, 'src/shared/public'),
    cacheDir:paths.directory('est-gui','cache','vite-web'),
    // Linked CommonJS contracts change in place without a lockfile/version bump.
    optimizeDeps: { include: ["@effectstreamer/common"], force: true },
    plugins: [react(), tailwindcss(), {
        name: 'explicit-web-output',
        apply: 'build',
        config(config) {
            if (!config.build?.outDir) throw new Error('Use npm run build:web, or specify an outDir for a test build.');
        }
    }],
    resolve: { alias: { "/src/renderer/windowMain": renderer, "@": renderer, "@runtime-platform": resolve(renderer, "runtime/browser.js") } },
    build: { emptyOutDir:false, commonjsOptions: { include: [/node_modules/, /[/\\]common[/\\]/] } }
});
