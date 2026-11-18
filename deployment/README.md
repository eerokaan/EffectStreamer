# EffectStreamer Deployment

## Introduction

EffectStreamer runs as standalone applications on Linux and Windows:

- **Local-use:** One server and two native Electron clients, each with its bundled core.
- **Remote-use:** One coordinator with bundled cores, plus an external HTTPS server for the browser frontend.

Transfer the complete platform-matched distributions, not just their executables. Keep the coordinator's `core/` directory beside its executable. Use one coordinator per results directory.

## The configuration files

Choose the example for the intended use; both server examples set `server.mode` explicitly and expose the same supported settings:

| Component/use | Example | Runtime filename |
| --- | --- | --- |
| Server, local-use | [est-server.config.local.example.json](../est-server/est-server.config.local.example.json) | `est-server.config.json` |
| Server, remote-use | [est-server.config.remote.example.json](../est-server/est-server.config.remote.example.json) | `est-server.config.json` |
| Electron GUI, local-use | [est-gui.config.example.json](../est-gui/est-gui.config.example.json) | `est-gui.config.json` |

Copy the selected examples to `~/effectstreamer/` on Linux or `%USERPROFILE%\effectstreamer\` on Windows, using the account running each application. Remote-use browsers need no GUI JSON file. See the [server](../est-server/README.md) and [GUI](../est-gui/README.md) READMEs for supported configuration fields.

For either mode, set `sessions.general.language` in `est-server.config.json` to exactly `en` or `de`. The server has no default and reads the setting at startup. This selects the study language for all participants and the bundled audio-check WAV. Between studies, deploy matching releases of the coordinator and the frontend for the study mode (the external site or both Electron clients); mixed-release clients are not supported.

The server saves results to `~/effectstreamer/sessions` on Linux or `%USERPROFILE%\effectstreamer\sessions` on Windows. Protect configuration, credentials, certificates and study results; back them up and never place them in temporary storage. Saves are direct and non-atomic: an interrupted write can leave incomplete JSON/WAV files, and a WAV filename alone does not prove successful collection.

### Starting a new study

Finish the current study and verify that its recordings have been collected before starting a new study or changing the language. To start with fresh enrollments, stop the server or its supervising service and wait for the coordinator to exit. Move the entire `sessions` directory to a persistent archive, then restart the server. It creates a fresh `sessions` directory on startup.

If you reuse the **same local coordinator URL**, close both Electron clients and move each client's `est-gui.config.json.enrollment.json` out of its active configuration directory and into the study archive before relaunching. Keep any existing recordings with the original study. Returning remote participants should open the new study link in a fresh tab rather than reusing the previous study tab.

## Usage

### Local-use

Configure the server's LAN address and give the two Electron clients distinct `client-a`/`client-b` identities and reachable LAN addresses. Start the server before both clients; use the [GUI launch instructions](../est-gui/README.md#usage) for the matching AppImage or Windows installer. Audio setup is optional only when disabled by the local-use server configuration.

### Remote-use

Replace the example study IDs, completion codes, DNS names and experiment settings. Keep the server on `127.0.0.1:3000` behind an HTTPS proxy and configure reachable ICE/TURN services as described below. The bundled core is selected automatically as adjacent `core/est-core` on Linux or `core/est-core.exe` on Windows; no core-path setting is needed. Start conservatively with `server.maxActivePairs: 1`; this is an admission limit, not measured capacity. Device/P.501 setup (`sessions.general.audioSetup`) is mandatory remotely.

### Linux

From the server distribution directory, launch either configured mode with:

```bash
chmod +x est-server
EST_SERVER_TYPE=harness ./est-server
```

### Windows

From the server distribution directory in Command Prompt, launch either configured mode with:

```bat
set "EST_SERVER_TYPE=harness"
est-server.exe
```

`harness` supervises the coordinator with bounded restart delay; `EST_SERVER_TYPE=server` runs it directly under an external service manager. Run the service under the account that owns the configuration and results.

## Networking

For **remote-use**, copy the **contents** of `est-gui/dist/web/` to a fresh document root on the external HTTPS server. For example, on Linux, from the repository root:

```bash
sudo install -d -m 0755 /var/www/effectstreamer
sudo cp -R est-gui/dist/web/. /var/www/effectstreamer/
```

The result must be `/var/www/effectstreamer/index.html`, with `assets/` and `audio/` beside it. Serve that index for `/` and `/experiment`, including entry URLs with query strings, without redirecting away the Prolific parameters. Keep configuration, credentials, certificates and results outside the document root.

On the **same HTTPS origin**, forward `/api/` (including recording uploads) and `/socket.io/` to the coordinator without stripping either prefix. The [nginx example](nginx.example.conf) uses `127.0.0.1:3000` because both processes run on the same machine. If the web server is on another machine, point its upstream at a private connection or tunnel to the coordinator; participants still use only the public study URL.

Support Socket.IO polling and WebSocket upgrades, and allow 1 MiB upload chunks plus request framing. For nginx, include the example in the `http` context, set the hostname, document root and TLS paths, then run `sudo nginx -t` before reloading. Use valid certificates, HSTS, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`; permit same-origin microphone/speaker selection. Ensure no proxy, CDN or application log captures study query strings containing Prolific identifiers or JWTs.

Use an existing compatible STUN/TURN service or the optional [coturn example](turnserver.example.conf). For coturn, copy it to private `turnserver.local.conf`, replace public IP/DNS/certificate paths and generate a private random `static-auth-secret`. Put the same value in `remote.turnSecret` in the private `est-server.config.json`, and set `remote.iceServers` and `remote.turnUrls` to the reachable service URLs. The template is not runnable as-is. Start coturn independently on a supported host, for example `turnserver -c /absolute/path/to/turnserver.local.conf`; it need not run on the same machine or OS as EffectStreamer. Arrange certificate renewal/reload for both HTTPS and TURN hostnames.

Keep the coordinator and TURN hosts' system clocks synchronized so expiring authentication credentials remain valid.

| Port(s) | Remote-use purpose |
| --- | --- |
| TCP 443 | Public HTTPS, including Socket.IO and uploads. TCP 80 is needed only if the chosen certificate setup requires it. |
| TCP 3000 | Loopback-only coordinator backend; do not expose it directly. |
| UDP 40000–49999 | Private loopback RTP/L16; never expose this range publicly. |
| UDP 50000–59999 | Public core ICE range from the remote-use server example. |
| UDP + TCP 3478 | Public STUN/TURN service. |
| TCP 5349 | Public TURN-over-TLS service, not HTTPS. |
| UDP 60000–60999 | Public coturn relay allocation range from the optional template. |

Use publicly reachable or STUN-derived core ICE candidates and configure actual firewall/NAT forwarding. A coturn host behind NAT may need `external-ip=PUBLIC/PRIVATE`; forward its relay range. Keep the template's loopback/private-target restrictions rather than making TURN a route into the LAN. HTTPS does not relay media. TURN/TLS on port 443 requires a different public IP from the HTTPS service and still needs forced-relay testing on participant networks.

## Compilation

Building requires Node 22.22.3/npm 10.9.8, a compiler, the matching GStreamer 1.28.7 target SDK, and the custom `estnetsim` plugin, not GStreamer's standard `netsim`. Its source is not included; obtain matching binaries/source provenance and supply required third-party license notices/source offers. Set `SDK` and `EST_NETSIM_PLUGIN` to absolute target-specific paths. Hydrate renderer images with Git LFS on a fresh clone without overwriting existing researcher edits; tracked packaged cores/runtime ZIPs are not source-build inputs.

Follow the [core](../est-core/README.md), [server](../est-server/README.md#compilation) and [GUI](../est-gui/README.md#compilation) build instructions. From the repository root, the Linux build order is:

```bash
npm --prefix est-server ci
npm --prefix est-gui ci
TARGET_OS=linux bash est-core/build_scripts/build.sh
npm --prefix est-server run build:linux
# For remote-use, build the standalone site:
npm --prefix est-gui run build:web
# For local-use, package the native clients instead:
npm --prefix est-gui run build:linux
```

For Windows targets, use the matching MinGW SDK and `.dll` plugin, unset Linux-only `EST_PKG_CONFIG_EXTRA_PATH`, and select `TARGET_OS=win` and the `build:win` npm commands instead of their Linux equivalents. Server distributions go to `est-server/dist/linux` or `est-server/dist/win`; GUI distributions go to `est-gui/dist/linux` (AppImage), `est-gui/dist/win` (installer) or `est-gui/dist/web` (static site, independent of OS). Server packaging does not require a web build. `EST_DISTRIBUTION_DIR` selects another new final destination for an individual build. Builds refuse existing destinations, but failed assembly can leave incomplete output which must not be deployed. Target machines still need compatible system libraries; a cross-build is not native Windows execution or an arbitrary Linux portability guarantee.

## Verification

Before recruitment, verify the actual target OS, devices and participant networks:

- **Local-use:** Linux ALSA or Windows WASAPI2 discovery, default/non-default physical input/output, audible P.501 checks, both SCT/LST roles and receipt-confirmed WAV collection.
- **Remote-use:** desktop Chrome, Edge, Firefox and real Safari permissions, output routes and audible conversations. Mobile devices are excluded; automated Chromium/WebKit checks do not establish Edge/Safari or physical-device acceptance.
- **Remote-use:** check that `/` and `/experiment?probe=1` load the index and its scripts on the public HTTPS origin, preserving the query string. Check that `/api/config` returns `Cache-Control: no-store` and no private secrets. With a valid study link, verify audio setup, authenticated Socket.IO upgrades and chunk uploads. Check direct ICE and independently forced TURN UDP, TCP-only and TLS-only routes; listing relay URLs is not proof of relay selection.
- **Both modes:** ratings, expected 48 kHz mono PCM WAVs and matching durable receipts; disconnect/rejoin, reload with lost in-memory audio, interrupted uploads and coordinator restart must not certify missing data as complete.
- **Both languages:** check the server's `sessionLanguage` and resolved setup WAV, run through setup, questionnaire and both task roles, and check the saved language in `session.json`. The 11 provisional English study images still have their original German text.
- **Both modes:** sustained condition duration/load, bounded shutdown, process/port cleanup and persistent backups. Validate capacity before increasing pair limits; do not infer production capacity from localhost samples.

These are operator release checks, not claims that a live deployment, native Windows, real hardware or Internet/TURN acceptance has already passed.

## Temporary files

Build intermediates, tool and runtime caches, and generated test fixtures and reports are disposable. On Linux, including when cross-building for Windows, they live under `/tmp/effectstreamer/<user>/<checkout-or-installation>/<component>/`. Native Windows uses the `effectstreamer` subtree of its system temporary directory. Separate checkouts and test runs have isolated paths.

Keep installed dependencies and SDKs, final `dist` outputs, configuration, credentials, recordings and study results outside temporary storage. After cleanup, rebuild any compiled inputs needed for tests or packaging; the tools recreate their temporary directories. Reboot cleanup depends on OS policy; EffectStreamer does not install a cleanup service.

For optional Linux systemd boot cleanup, an administrator may install the [tmpfiles example](tmpfiles.example.conf), from the repository root:

```bash
sudo install -m 0644 deployment/tmpfiles.example.conf /etc/tmpfiles.d/effectstreamer.conf
```

The rule removes contents only during boot-mode removal. Do not invoke `systemd-tmpfiles --remove --boot` while builds or experiments are running. Installing this Linux rule does not configure Windows cleanup.
