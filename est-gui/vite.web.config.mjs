import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": resolve(import.meta.dirname, "src/renderer/windowMain"), "@runtime-platform": resolve(import.meta.dirname, "src/renderer/windowMain/runtime/browser.js") } },
    build: { outDir: "out/web", commonjsOptions: { include: [/node_modules/, /est-common/] } }
});
