import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    main: {
        resolve: {
            alias: [{ find: "@", replacement: resolve(__dirname, "./src") }]
        }
    },
    preload: {
        resolve: {
            alias: [{ find: "@", replacement: resolve(__dirname, "./src") }]
        }
    },
    renderer: {
        publicDir: resolve(__dirname, "public"),
        build: {
            commonjsOptions: { include: [/node_modules/, /est-common/] },
            rollupOptions: {
                input: {
                    windowMain: resolve(__dirname, "./src/renderer/windowMain.html")
                }
            }
        },
        resolve: {
            alias: [{ find: "@", replacement: resolve(__dirname, "./src/renderer/windowMain") }, { find: "@runtime-platform", replacement: resolve(__dirname, "./src/renderer/windowMain/runtime/electron.js") }]
        },
        plugins: [react(), tailwindcss()]
    }
});
