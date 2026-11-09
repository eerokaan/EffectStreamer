import path from 'node:path';
import {createTransientPaths} from '@effectstreamer/common/transient-paths';

export function configureTransientRuntime(app) {
    const profile=createTransientPaths({anchor:path.join(app.getPath('home'),'effectstreamer')});
    const release=profile.acquireProcessLock('est-gui','profile');
    app.once?.('will-quit',release);
    const anchor=app.isPackaged?path.dirname(app.getPath('exe')):path.resolve(process.env.EST_GUI_SOURCE_ROOT || app.getAppPath(),'..');
    const paths=createTransientPaths({anchor}),env=paths.environment('est-gui');
    Object.assign(process.env,env);
    app.setPath('temp',env.TMPDIR);
    // Participant credentials, device settings and pending WAVs live in explicit
    // durable files; this renderer has no required persistent browser storage.
    app.setPath('sessionData',paths.temporaryDirectory('est-gui','session-'));
    app.setPath('crashDumps',paths.directory('est-gui','cache','crash-dumps'));
    app.setAppLogsPath(paths.directory('est-gui','logs'));
}
