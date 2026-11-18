import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {createRequire} from 'node:module';
const {checkoutPaths}=createRequire(import.meta.url)('../common/transient-paths.cjs');
const paths=checkoutPaths(),source=import.meta.dirname;
const output=part=>paths.directory('est-gui','app','out',part);
const cache=part=>paths.directory('est-gui','cache','vite-'+part);

export default defineConfig({
    main: {
        root:source, cacheDir:cache('main'), build:{outDir:output('main'),emptyOutDir:true},
        resolve: {
            alias: [{ find: "@", replacement: resolve(source, "./src") }]
        }
    },
    preload: {
        root:source, cacheDir:cache('preload'), build:{outDir:output('preload'),emptyOutDir:true},
        resolve: {
            alias: [{ find: "@", replacement: resolve(source, "./src") }]
        }
    },
    renderer: {
        cacheDir:cache('renderer'), publicDir: resolve(source, "src/shared/public"),
        build: {
            outDir:output('renderer'),emptyOutDir:true,
            commonjsOptions: { include: [/node_modules/, /[/\\]common[/\\]/] },
            rollupOptions: {
                input: {
                    windowMain: resolve(source, "./src/renderer/windowMain.html")
                }
            }
        },
        resolve: {
            alias: [{ find: "@", replacement: resolve(source, "./src/renderer/windowMain") }, { find: "@runtime-platform", replacement: resolve(source, "./src/renderer/windowMain/runtime/electron.js") }]
        },
        plugins: [react(), tailwindcss()]
    }
});
