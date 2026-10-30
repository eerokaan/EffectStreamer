import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
    resolve: { alias: { "@": resolve(import.meta.dirname, "src/renderer/windowMain") } },
    test: { environment: "node", include: ["test/**/*.test.mjs"], testTimeout: 10000 }
});
