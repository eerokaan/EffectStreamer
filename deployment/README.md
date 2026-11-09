# EffectStreamer Deployment

## Introduction

EffectStreamer runs as standalone applications on Linux and Windows:

- **Local-use:** one server and two native Electron clients, each with its bundled core/runtime.
- **Remote-use:** one server with bundled cores/runtime and the browser frontend; participants use desktop browsers without installing a client.

Transfer the complete platform-matched distributions, not just their executables. Keep the server's `core/` and `web/` resources together. Use one coordinator per results directory; distributed matchmaking and shared-directory replicas are not supported.

## The configuration files

Choose the example for the intended use; both server examples set `deployment.mode` explicitly:

| Component/use | Example | Runtime filename |
| --- | --- | --- |
| Server, local-use | [config-server.example.json](../est-server/config-server.example.json) | `config-server.json` |
| Server, remote-use | [config-server.remote.example.json](../est-server/config-server.remote.example.json) | `config-server.json` |
| Electron GUI, local-use | [config-gui.example.json](../est-gui/config-gui.example.json) | `config-gui.json` |

Copy the selected examples to `~/effectstreamer/` on Linux or `%USERPROFILE%\effectstreamer\` on Windows, using the account running each application. `EST_CONFIG_PATH` selects another private server configuration. Remote-use browsers need no GUI JSON file. See the [server](../est-server/README.md) and [GUI](../est-gui/README.md) READMEs for configuration fields and legacy filename migration.

The server saves results under `~/effectstreamer/sessions` unless `EST_RESULTS_ROOT` selects another durable, writable directory. Protect configuration, credentials, certificates and study results; back them up and never place them in temporary storage. Saves are direct and non-atomic: an interrupted write can leave incomplete JSON/WAV files, and a WAV filename alone does not prove successful collection.

## Usage

### Local-use

Configure the server's LAN address and give the two Electron clients distinct `client-a`/`client-b` identities and reachable LAN addresses. Permit only their configured signaling/RTP routes. Start the server before both clients; use the [GUI launch instructions](../est-gui/README.md#usage) for the matching AppImage or Windows installer. Audio setup is optional only when disabled by the local-use server configuration.

### Remote-use

Replace the example study IDs, completion codes, DNS names and experiment settings. Keep the server on `127.0.0.1:3000` behind an HTTPS proxy and configure reachable ICE/TURN services as described below. Set `remote.coreExecutable` to `core/est-core` on Linux or `core/est-core.exe` on Windows; relative core paths resolve beside the packaged server, not the caller's working directory. Start conservatively with `maxActivePairs: 1`; this is an admission limit, not measured capacity. Device/P.501 setup is mandatory remotely.

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

`harness` supervises the coordinator with bounded restart delay; `EST_SERVER_TYPE=server` runs it directly under an external service manager. Services must explicitly use the intended account, configuration and results paths. No service or host configuration is installed automatically.

## Networking

The following requirements apply to **remote-use**. Use any suitable HTTPS/WebSocket reverse proxy; no particular proxy implementation is required. Serve the frontend, API, uploads and Socket.IO at one HTTPS origin, forwarding to `127.0.0.1:3000` with WebSocket upgrades. Allow the configured upload chunk size plus request framing. Use valid certificates, HSTS, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`; permit same-origin microphone/speaker selection. Do not log study query strings containing Prolific identifiers or JWTs, or expose private configuration/results.

Use an existing compatible STUN/TURN service or the optional [coturn example](turnserver.conf). For coturn, copy it to private `turnserver.local.conf`, replace public IP/DNS/certificate paths and generate a private random `static-auth-secret`. Supply the same value to the EffectStreamer server through `EST_TURN_SECRET`; set `remote.iceServers` and `remote.turnUrls` to the reachable service URLs. The template is not runnable as-is. Start coturn independently on a supported host, for example `turnserver -c /absolute/path/to/turnserver.local.conf`; it need not run on the same machine or OS as EffectStreamer. Arrange certificate renewal/reload for both HTTPS and TURN hostnames.

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
npm --prefix est-gui run build:web
npm --prefix est-server run build:linux
# For local-use, also package the native clients:
npm --prefix est-gui run build:linux
```

For Windows targets, use the matching MinGW SDK and `.dll` plugin, unset Linux-only `EST_PKG_CONFIG_EXTRA_PATH`, and select `TARGET_OS=win` and the `build:win` npm commands instead. Server distributions go to `est-server/dist/linux` or `est-server/dist/win`; GUI packages go to `est-gui/dist`. `EST_DISTRIBUTION_DIR` selects another new final destination. Builds refuse existing destinations, but failed assembly can leave incomplete output which must not be deployed. Target machines still need compatible system libraries; a cross-build is not native Windows execution or an arbitrary Linux portability guarantee.

## Verification

Before recruitment, verify the actual target OS, devices and participant networks:

- **Local-use:** Linux ALSA or Windows WASAPI2 discovery, default/non-default physical input/output, audible P.501 checks, both SCT/LST roles and receipt-confirmed WAV collection.
- **Remote-use:** desktop Chrome, Edge, Firefox and real Safari permissions, output routes and audible conversations. Mobile devices are excluded; automated Chromium/WebKit checks do not establish Edge/Safari or physical-device acceptance.
- **Remote-use:** valid HTTPS, frontend/audio assets, authenticated Socket.IO upgrades, and `/api/config` with `Cache-Control: no-store` and no private secrets. Check direct ICE and independently forced TURN UDP, TCP-only and TLS-only routes; listing relay URLs is not proof of relay selection.
- **Both modes:** ratings, expected 48 kHz mono PCM WAVs and matching durable receipts; disconnect/rejoin, reload with lost in-memory audio, interrupted uploads and coordinator restart must not certify missing data as complete.
- **Both modes:** sustained condition duration/load, bounded shutdown, process/port cleanup and persistent backups. Validate capacity before increasing pair limits; do not infer production capacity from localhost samples.

These are operator release checks, not claims that a live deployment, native Windows, real hardware or Internet/TURN acceptance has already passed.

## Temporary files

Disposable builds/caches use `/tmp/effectstreamer` on Linux and the system temporary directory's `effectstreamer` subtree on native Windows. Rebuild required inputs after cleanup; never move configuration, recordings or results there. Reboot cleanup depends on OS policy.

For optional Linux systemd boot cleanup, an administrator may install the shared [tmpfiles rule](../est-common/effectstreamer-tmpfiles.conf), from the repository root:

```bash
sudo install -m 0644 est-common/effectstreamer-tmpfiles.conf /etc/tmpfiles.d/effectstreamer.conf
```

The rule removes contents only during boot-mode removal. Do not invoke `systemd-tmpfiles --remove --boot` while builds or experiments are running. Installing this Linux rule does not configure Windows cleanup.
