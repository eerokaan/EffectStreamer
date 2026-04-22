import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    main: {},
    preload: {},
    renderer: {
        build: {
            rollupOptions: {
                input: {
                    windowMain: resolve(__dirname, "./src/renderer/windowMain.html")
                }
            }
        },
        resolve: {
            alias: {
                "@": resolve("./src/renderer/windowMain")
            }
        },
        plugins: [react(), tailwindcss()]
    }
});
