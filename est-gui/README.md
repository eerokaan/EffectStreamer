# EffectStreamer GUI

## Introduction

This is the EffectStreamer GUI – the participant-facing interface of EffectStreamer, guiding participants through the experiment and collecting their evaluations and audio.

The same React frontend builds as a native Electron application or a browser application. Electron uses bundled ALSA/WASAPI2 cores by default; the browser uses server-hosted cores over WebRTC. The coordinator selects the deployment mode; mixed native/browser pairs are not supported.

## The configuration file

Before starting the GUI, create `~/effectstreamer/config-gui.json` for the current OS user. `config-gui.example.json` is the repository template; the application does not search for or migrate legacy adjacent configuration files:

```
{
    "server": {
        "ipAddress": "127.0.0.1",
        "port": "3000"
    },
    "client": {
        "identity": "client-a",
        "ipAddress": "192.168.1.10"
    },
    "audio": {
        "backend": "native",
        "devices": { "source": "default", "sink": "default" },
        "recordingDir": null
    }
}
```

Use `client-a` and `client-b` on the two participant machines, with their reachable LAN addresses. `server.url` may replace legacy `server.ipAddress`/`port` (for example `https://coordinator.example.org`). `audio.devices` holds ALSA/WASAPI2 IDs in native mode, not browser IDs; historical `client.audioDevices` browser values are not reused for native audio. `default` is selected initially; the device picker (`Ctrl+Alt+O`) lists and tests actual backend routes. Local setup is enforced only when enabled by the coordinator. Changing a route invalidates its previous test; changes are locked during active attempts.

`audio.recordingDir` overrides the default `~/effectstreamer/recordings`. Unique session/attempt/participant directories keep both WAVs and interrupted attempts separate. Pending-file inventory and reconnect credentials survive relaunch. Files are removed only after matching server storage receipts, never simply on closing the application. Optional `audio.backend: "stdio"` uses browser PCM pipes instead of native capture; its device IDs belong to a separate namespace.

To begin another local run after the session has ended, close and relaunch both clients. The saved enrollment resumes an unfinished run but obtains fresh participant/session IDs for the next ended-to-new run; previous results are not overwritten. No coordinator restart or manual enrollment-file deletion is needed.

## Browser deployment

Run `npm run build:web`; serve `out/web` through the coordinator or the documented same-origin deployment. The browser fetches `/api/config`, admits the Prolific identifiers from the study URL, performs mandatory device/P.501 checks and joins FIFO pairing after the questionnaire. No GUI JSON file or installed binary is needed. Session reconnect credentials remain in tab session storage; a page reload cannot restore unuploaded audio held in RAM.

Desktop/laptop Chrome, Edge, Firefox and Safari are targets; phones/tablets are rejected, not small desktop windows. Browser input requests disable echo cancellation/noise suppression/AGC and shows reported settings; unsupported settings remain unknown. HTML audio `setSinkId` selects the actual output where available; Firefox may require the explicit output-permission button. When concrete routing is unavailable, only system default is offered. P.501 playback must finish and be confirmed audible; input-level feedback never monitors the microphone audibly. A user-authorized 48 kHz AudioContext is retained for PCM recording; unsupported rates/autoplay failures fail explicitly. Real Safari/hardware validation remains a release gate, not a claim from WebKit automation.

## Usage

### Linux

Make the AppImage executable and start it with:

```
chmod +x EffectStreamer_GUI*.AppImage
./EffectStreamer_GUI*.AppImage
```

The AppImage reads `~/effectstreamer/config-gui.json`.

### Windows

Run the installer `EffectStreamer_GUI.exe` and start EffectStreamer from the Start Menu or the installed executable.

Packaged Windows builds read `%USERPROFILE%\effectstreamer\config-gui.json`.

## Compilation

Electron packaging uses fresh source outputs and matching GStreamer runtime inputs, never tracked `build/*` binaries/ZIPs. First build the target core with `est-core/build_scripts/build.sh`; set `SDK` and `EST_NETSIM_PLUGIN` to the matching target inputs. The packaging hook stages required plugins/libraries/scanner in a new `out/native-resources-*` directory. Alternatively set `EST_GUI_CORE_RESOURCES` to an already-staged core directory from `stage-runtime.cjs`. P.501 is included as a native resource and web static asset. See [deployment build inputs](../deployment/README.md).

The documented toolchain is Node 22.22.3/npm 10.9.8. Development verification also ran on Node 24.21.0/npm 11.19.0; this does not replace testing the documented release toolchain or real installers on their target OS.

To create the Linux AppImage:

```
npm install
npm run build:linux
```

The AppImage will be written to `est-gui/dist`.

To create the Windows NSIS installer:

```
apt-get install wine
ln -s /usr/bin/wine /usr/local/bin/wine64

npm install
npm run build:win
```

The NSIS installer will be written to `est-gui/dist`.
