import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// Exercise the same build tools the application installs, not a second copy
// chosen transitively by the test runner.
const require=createRequire(new URL('../../est-gui/package.json',import.meta.url));
const vite=await import(pathToFileURL(require.resolve('vite')).href);
const electronVite=await import(pathToFileURL(require.resolve('electron-vite')).href);
export const {build,createServer,preview}=vite;
export const {loadConfigFromFile}=electronVite;
