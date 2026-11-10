const os=require('node:os');
const path=require('node:path');
const {checkoutPaths}=require('../common/transient-paths.cjs');

function testEnvironment(component,input=process.env) {
    const env=checkoutPaths().environment(component,input);
    if(component==='est-gui') {
        // Resolve the installed browser cache before redirecting XDG_CACHE_HOME.
        const browserCache=process.platform==='win32'?path.join(input.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'ms-playwright'):
            process.platform==='darwin'?path.join(os.homedir(),'Library','Caches','ms-playwright'):path.join(input.XDG_CACHE_HOME || path.join(os.homedir(),'.cache'),'ms-playwright');
        env.PLAYWRIGHT_BROWSERS_PATH=input.PLAYWRIGHT_BROWSERS_PATH || browserCache;
    }
    return env;
}
module.exports={testEnvironment};
