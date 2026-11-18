import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),guiRequire=createRequire(new URL('../../est-gui/package.json',import.meta.url));
const {checkoutPaths}=require('../../common/transient-paths.cjs');
const {testEnvironment}=require('../environment.cjs');
const paths=checkoutPaths(),environment=testEnvironment('est-gui');
Object.assign(process.env,environment);
const run=environment.EST_TRANSIENT_RUN_DIR;
export default defineConfig({
    root:import.meta.dirname,cacheDir:paths.directory('est-gui','cache','vitest'),
    resolve: { alias: { "@/main": resolve(import.meta.dirname, "../../est-gui/src/main"), "@": resolve(import.meta.dirname, "../../est-gui/src/renderer/windowMain"),electron:guiRequire.resolve('electron') } },
    test: { environment: "node", include: ["*.test.mjs"], testTimeout: 10000,
        fsModuleCachePath:paths.directory('est-gui','cache','vitest-modules'),
        coverage:{reportsDirectory:resolve(run,'coverage')},
        outputFile:{json:resolve(run,'vitest.json'),junit:resolve(run,'junit.xml'),blob:resolve(run,'vitest-blob.json')} }
});
