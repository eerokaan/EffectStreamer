# EffectStreamer GUI

## Introduction

This is the EffectStreamer GUI – the participant-facing interface of EffectStreamer, guiding participants through the experiment and collecting their evaluations and audio.

The same React frontend builds as a native Electron application or a browser application. Electron uses bundled ALSA/WASAPI2 cores by default; the browser uses server-hosted cores over WebRTC. The coordinator selects the deployment mode; mixed native/browser pairs are not supported.

## Study language and materials

The required `sessions.general.language` setting in `est-server.config.json` selects `en` or `de` for both client types. It controls the shared screens, task text, packaged rating and instruction images, and P.501 check sample. It is not a GUI or participant preference. Deploy matching server and client builds together between studies.

- Edit `src/renderer/windowMain/assets/languages/en.csv` and `de.csv` as UTF-8 CSV with `source,translation` headers. Use the same English source phrase in both files and keep `{{placeholders}}` identical across languages. For a questionnaire, set each display field to its source phrase and add the corresponding rows; unknown custom text is displayed verbatim. Do not change field names or stored choice values to translate their labels.
- The SCT and LST pages under `assets/html/` share markup across languages. `data-translate` marks a text-only element; use its English text or an explicit key in the attribute. Keep the paired cues, table structure, editable controls and read-aloud paragraph boundaries intact.
- Initial English PNGs are **German placeholders**. Replace the 8 files in `assets/img/scales/en/`, `assets/img/short-conversation-test/en/explanation.png`, and `assets/img/listening-speaking-test/en/{explanation,listener}.png`. Keep the scale image geometry and tick/endpoint positions; scoring converts pointer coordinates using the original dimensions.
- Both P.501 WAVs come from `src/shared/public/audio/` and ship with both clients. Each client uses the bundled file matching the coordinator's study language. There is no custom WAV setting.

## The configuration file

For local-use Electron clients, copy the repository template `est-gui.config.example.json` to the runtime location for the account running the application:

| Platform | GUI configuration, local-use |
| --- | --- |
| Linux | `~/effectstreamer/est-gui.config.json` |
| Windows | `%USERPROFILE%\effectstreamer\est-gui.config.json` |

For remote-use browser clients, no GUI JSON file is needed: configuration is fetched from the server.

An example local-use configuration is:

```
{
    "server": {
        "url": "http://127.0.0.1:3000"
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

Use `client-a` and `client-b` on the two participant machines, with their reachable LAN addresses. `server.url` is the coordinator's HTTP(S) origin (for example `https://coordinator.example.org`), without credentials, a path, query or fragment. `audio.devices` holds the selected input/output IDs for either backend: ALSA/WASAPI2 IDs in native mode, browser IDs in stdio mode. Native `default` routes are selected initially; the device picker (`Ctrl+Alt+O`) lists and tests actual backend routes. Only the documented configuration fields are accepted. Local setup is enforced only when enabled by the coordinator. Changing a route invalidates its previous test; changes are locked during active attempts.

`audio.recordingDir` overrides the default `~/effectstreamer/recordings`. Unique session/attempt/participant directories keep both WAVs and interrupted attempts separate. Pending-file inventory and reconnect credentials survive relaunch. Files are removed only after matching server storage receipts, never simply on closing the application. Optional `audio.backend: "stdio"` uses browser PCM pipes instead of native capture; its device IDs belong to a separate namespace.

To begin another local run after the session has ended, close and relaunch both clients. The saved enrollment resumes an unfinished run but obtains fresh participant/session IDs for the next ended-to-new run; previous results are not overwritten. No coordinator restart or manual enrollment-file deletion is needed.

## Browser deployment

From `est-gui/`, run `npm run build:web`. Vite builds `src/web/index.html` into the standalone site at `est-gui/dist/web/`. Copy the **contents** of that directory to the external HTTPS document root so `index.html`, `assets/` and `audio/` sit directly under it. Serve the index for both `/` and `/experiment`, preserving the study query string. Proxy `/api/` (including uploads) and `/socket.io/` on that origin to `est-server`, with WebSocket upgrades enabled for Socket.IO. See the [deployment example](../deployment/README.md#networking).

The browser fetches `/api/config`, submits the Prolific identifiers from the study URL, performs mandatory device/P.501 checks and joins FIFO pairing after the questionnaire. No GUI JSON file or installed binary is needed. Session reconnect credentials remain in tab session storage; a page reload cannot restore unuploaded audio held in RAM.

Desktop/laptop Chrome, Edge, Firefox and Safari are targets; phones and tablets are not supported. Browser input requests disable echo cancellation/noise suppression/AGC and show reported settings; unsupported settings remain unknown. HTML audio `setSinkId` selects the actual output where available; Firefox may require the explicit output-permission button. When concrete routing is unavailable, only system default is offered. P.501 playback must finish and be confirmed audible; input-level feedback never monitors the microphone audibly. A user-authorized 48 kHz AudioContext is retained for PCM recording; unsupported rates/autoplay failures fail explicitly. Real Safari/hardware validation remains a release gate, not a claim from WebKit automation.

## Usage

### Linux

From the directory containing the AppImage (`est-gui/dist/linux/` after packaging), make it executable and start it:

```
chmod +x ./*.AppImage
./*.AppImage
```

For local-use, the AppImage reads `~/effectstreamer/est-gui.config.json`.

### Windows

Run the `.exe` installer from `est-gui/dist/win/` and start EffectStreamer from the Start Menu or the installed executable.

For local-use, packaged Windows builds read `%USERPROFILE%\effectstreamer\est-gui.config.json`.

## Compilation

Electron packaging uses fresh source outputs and matching GStreamer runtime inputs, never tracked `build/*` binaries/ZIPs. First build the target core with `est-core/build_scripts/build.sh`; set `SDK` and `EST_NETSIM_PLUGIN` to the matching target inputs. `afterPack` writes runtime resources directly into the application's final resource directory. Alternatively set `EST_GUI_CORE_RESOURCES` to existing complete resource inputs. P.501 is included as a native resource and web static asset. See [deployment build inputs](../deployment/README.md).

Use the npm build/dev/preview/lint commands so intermediate application inputs, configuration bundles and tool caches stay under `/tmp/effectstreamer` on Linux. Automated tests and browser tooling are managed separately in [`test/`](../test/README.md). Development dependency resolution still uses installed source dependencies; packaged applications contain their own production modules and do not depend on the builder's temporary tree. Electron session/cache/log/crash-dump files are disposable, but explicit configuration, enrollment credentials and pending WAVs remain at their existing durable locations.

The wrappers accept supported build and launch options but reject forwarded output/configuration overrides that bypass managed paths. Choose a different final destination for an individual build with `EST_DISTRIBUTION_DIR`. Only one GUI instance may use the same durable home profile at a time; concurrent direct JSON saves are serialized.

Configuration, credentials and pending-recording JSON are saved directly to their destinations. Interrupted writes can corrupt them. Uploaded WAVs likewise occupy their final server filenames while incomplete; only successful validation and receipts establish completion. All three release builds write directly to a new target directory and refuse to overwrite it. A failed build may leave partial output; archive the target or choose a fresh destination before rebuilding.

The documented toolchain is Node 22.22.3/npm 10.9.8. Development verification also ran on Node 24.21.0/npm 11.19.0; this does not replace testing the documented release toolchain or real installers on their target OS.

To create the Linux AppImage:

```
npm install
npm run build:linux
```

The AppImage will be written to `est-gui/dist/linux`.

To create the Windows NSIS installer:

```
apt-get install wine
ln -s /usr/bin/wine /usr/local/bin/wine64

npm install
npm run build:win
```

The NSIS installer will be written to `est-gui/dist/win`.
