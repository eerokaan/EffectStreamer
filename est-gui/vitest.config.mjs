import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import {createRequire} from 'node:module';
const {checkoutPaths}=createRequire(import.meta.url)('../common/transient-paths.cjs');
const paths=checkoutPaths(),environment=paths.environment('est-gui');
Object.assign(process.env,environment);
const run=environment.EST_TRANSIENT_RUN_DIR;
export default defineConfig({
    root:import.meta.dirname,cacheDir:paths.directory('est-gui','cache','vitest'),
    resolve: { alias: { "@": resolve(import.meta.dirname, "src/renderer/windowMain") } },
    test: { environment: "node", include: ["test/**/*.test.mjs"], testTimeout: 10000,
        fsModuleCachePath:paths.directory('est-gui','cache','vitest-modules'),
        coverage:{reportsDirectory:resolve(run,'coverage')},
        outputFile:{json:resolve(run,'vitest.json'),junit:resolve(run,'junit.xml'),blob:resolve(run,'vitest-blob.json')} }
});
