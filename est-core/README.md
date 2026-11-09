# EffectStreamer Core

## Introduction

EffectStreamer Core is a standalone application for VoIP conversations under different impairment conditions. It supports host audio through ALSA on Linux and WASAPI2 on Windows, plus a raw stdio backend for an external audio host.

The following impairment arguments are supported:

| Impairment          | CLI Option                 | Mode     | Default Value | Valid Values               | Notes                                                              |
| ------------------- | -------------------------- | -------- | ------------- | -------------------------- | ------------------------------------------------------------------ |
| Native (End-to-End) | `--native-delay`           | Sender   | `0`           | `0` to `INT_MAX`           | Exact additional native-branch queue delay in milliseconds.        |
| Native (End-to-End) | `--native-gain`            | Receiver | `1.0`         | `0.0` to `1.0`             | `0.0` is 0% gain and `1.0` is 100% gain.                           |
| Echo                | `--echo-delay`             | Sender   | `0`           | `0` to `INT_MAX`           | Exact additional echo-branch queue delay in milliseconds.          |
| Echo                | `--echo-gain`              | Receiver | `0.0`         | `0.0` to `1.0`             | `0.0` is muted and `1.0` is 100% gain.                             |
| Packet Loss         | `--packetloss-type`        | Sender   | `none`        | `none`, `random`, `bursty` | Loss pattern type.                                                 |
| Packet Loss         | `--packetloss-ratio`       | Sender   | `0.0`         | `0.0` to `1.0`             | Values above `0.0` require `random` or `bursty` loss.              |
| Packet Loss         | `--packetloss-seed`        | Sender   | `0`           | `0` to `G_MAXUINT`         | `0` chooses a random seed per stream.                              |
| Packet Loss         | `--packetloss-burst-model` | Sender   | `g107-markov` | `g107-markov`              | ITU-T G.107 two-state Markov model.                                |
| Packet Loss         | `--packetloss-burst-ratio` | Sender   | `1.0`         | `1.0` to `8.0`             | ITU-T G.107 `BurstR` value.                                        |

## Usage

`--device-type` is required. Linux accepts `alsa`, `stdio` and `webrtc`; Windows accepts `wasapi2`, `stdio` and `webrtc`. `--device-id` is optional for host backends and invalid for `stdio`/`webrtc`. If a host device ID is omitted, the first matching source in sender mode or sink in receiver mode is selected; use explicit `default` for the backend default route. Device IDs are backend identifiers such as ALSA `hw:0,1` or a WASAPI2 endpoint ID, not display labels.

```
Sender mode:
./est-core \
    --mode sender --device-type <alsa|wasapi2|stdio> [--device-id <DEVICE-ID>] \
    --peerip <IP-ADDRESS> [--native-delay <MS>] [--echo-delay <MS>] \
    [--packetloss-type <none|random|bursty>] [--packetloss-ratio <0.0-1.0>] \
    [--packetloss-seed <INT>] [--packetloss-burst-model <g107-markov>] \
    [--packetloss-burst-ratio <1.0-8.0>] [--help]

Receiver mode:
./est-core \
    --mode receiver --device-type <alsa|wasapi2|stdio> [--device-id <DEVICE-ID>] \
    [--native-gain <GAIN>] [--echo-gain <GAIN>] [--help]
```

Each peer runs one sender and one receiver. Start both senders before the receivers so the receiver streams are available when playback and recording begin. The sender applies native delay, echo delay, and peer-branch packet loss. The receiver applies native and echo gain and records `microphone.wav` and `headphones.wav` under `~/effectstreamer`.

Recordings are mono, 48 kHz, signed 16-bit little-endian PCM WAV. Set `--recording-dir <directory>` on the receiver to choose their destination. Set `--recording none` on both roles to omit recording and the recording-only RTP branch. The default is `--recording wav`; managed applications use a unique directory per attempt. Existing microphone/playback taps and ordinary start/stop mechanics are retained, without saved alignment offsets, sample-count sidecars, gap logs or calibration.

Standalone RTP ports retain their defaults: sender `--peer-port 9004`, receiver `--listen-port 9004`, and both roles `--echo-port 9005 --record-port 9006`. Receivers additionally accept `--bind-address` (default `0.0.0.0`) and refuse port sharing. Assign unique port sets when running multiple participants on one machine, and keep server-hosted internal RTP on loopback/private interfaces.

### Native device setup utilities

```bash
./est-core --list-devices --device-type alsa
./est-core --mode test-input --device-type alsa --device-id default --test-duration-ms 1000
./est-core --mode test-output --device-type alsa --device-id default --test-file /path/to/P501.wav
```

Use `wasapi2` on Windows. Discovery emits JSON `{inputs,outputs}` with backend-native IDs, labels and default indicators, including devices hidden by desktop audio services. The explicit `default` choice uses the ALSA `default` route or the WASAPI2 system default; on ALSA this is not a promise that the first hardware device is the OS default. Availability is checked by opening the route. Omitted experiment device IDs retain first-matching-native-device discovery.

Input checks emit finite JSON access/peak feedback without audible monitoring or recording. Output checks decode the selected WAV through the same native sink as the experiment. Checks release their devices before exiting; a failed open emits `{ok:false,error:...}` and a nonzero exit code. Successful playback still requires the participant to confirm that they heard the sample. No additional audio-analysis files are saved.

For ALSA device IDs, use `arecord -l` for sources and `aplay -l` for sinks. For example, card 0, device 1 maps to `hw:0,1`. WASAPI2 endpoint IDs can normally be omitted and auto-detected.

Managed native hosts can add `--control ndjson`. Standard input/output then contain only version-1 NDJSON requests/replies/events; diagnostic logs remain on stderr. `--control none` is the standalone default. Never enable NDJSON with `--device-type stdio`, which retains raw F32LE PCM pipes.

After the `control-ready` event, send `{ "version": 1, "type": "request", "id": "start-1", "command": "audio.start", "payload": {} }`. `audio.stop` or `shutdown` requests EOS and a bounded graceful exit; stdin EOF has the same stop behavior. Wait for `recording-finalized` and successful process exit before collecting native recordings. `media-ready` indicates an observed media buffer, not merely control readiness or a start acknowledgement. The shared Node host is `@effectstreamer/common/core-process`.

## Compilation

### WebRTC backend

`--device-type webrtc --control ndjson` runs without a local audio device on Linux or Windows. A sender receives a single Opus microphone uplink; a receiver encodes its existing playback mix as one Opus downlink. A signaling host must pass an offer with `webrtc.offer` (`{type:"offer",sdp}`), apply the returned `{type:"answer",sdp}`, and exchange `ice-candidate` events and `webrtc.ice` requests (`{candidate,sdpMLineIndex:0}`). A null candidate signals end-of-candidates, including before the remote description is applied. Each process accepts one connection/offer; recreate it for another attempt.

Preparation emits `control-ready` without waiting for packets. Observe separate `connection-state` and `media-ready` events before starting a conversation with `audio.start`. Stop with `audio.stop`/`shutdown`; audio branches drain without injecting EOS into the encrypted ICE transport. In remote deployments use `--recording none` on both roles: participant browsers own the two WAV recordings. Raw stdio never carries signaling JSON.

`control-ready` follows nonblocking pipeline startup and local UDP binding, not successful ICE negotiation. A prepared WebRTC sender additionally accepts `audio.prime`: it opens the sender gate with microphone content muted in-core so both directions can be checked with silence. `audio.start` then unmutes it; priming cannot be re-entered once started. These silent preparation packets are outside the rated interaction and do not constitute microphone recording.

Optional settings are `--ice-min-port <first> --ice-max-port <last>`, `--webrtc-jitter-ms` (default 20), `--opus-bitrate` (default 128000), `--stun-server stun://host:port`, and up to eight `--turn-server turn[s]://user:password@host:port` arguments. Use GStreamer-compatible URL escaping for TURN credentials. These are transport settings, not measured end-to-end latency promises. ICE discovers interfaces normally; it is not pinned to localhost. Keep private RTP endpoints separate from the public ICE range.

The internal RTP/L16 sender now targets 128 mono frames per packet (`--rtp-frames`, 1–480), independent of normal incoming WebRTC/stdio block sizes. This intentionally replaces backend-dependent legacy packet granularity; loss is still applied on the same internal peer branch, not on public SRTP. Partial blocks at EOS or a source discontinuity are retained rather than padded or dropped, so those packets can be shorter. This does not add saved timing/gap-analysis data. Validate native hardware framing for the study before comparing old and new packet-loss results.

The build additionally links GStreamer SDP/WebRTC and needs matching Opus, RTP, libnice, DTLS and SRTP runtime plugins. For source SDKs referencing host metadata such as Linux libdrm, supply `EST_PKG_CONFIG_EXTRA_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig` if that dependency is already installed. Do not point Windows cross-compilation at Linux metadata. `EST_BUILD_TEST_PEER=1` additionally builds a sibling `webrtc-peer` offerer (`webrtc-peer.exe` for Windows) in the managed temporary build directory for integration tests; it is not shipped with the application.

### Standalone signaling reference

From the repository root, with the matching runtime environment (or a staged core):

```bash
node est-core/examples/webrtc-host.cjs /absolute/path/to/est-core \
    --mode sender --device-type webrtc --control ndjson --recording none \
    --peerip 127.0.0.1 --peer-port 45004 --echo-port 45005 \
    --ice-min-port 50000 --ice-max-port 50099
```

Open `http://127.0.0.1:8080`, click Connect and allow audio. This single-peer loopback reference demonstrates offer/answer, server ICE events and explicit start; a receiver example uses `--mode receiver --listen-port 45004 --echo-port 45005` and another `PORT`. Feed its private RTP inputs using the existing sender topology. It is not an Internet study server, multi-peer mixer, or authentication example. Use `est-server` for public admission/ownership/TLS/TURN. A bare core binary cannot negotiate a browser without such a host.

`build_scripts/stage-runtime.cjs` packages a source core and matching SDK shared libraries, required plugins, scanner and an explicitly supplied custom `EST_NETSIM_PLUGIN` into a new directory; it refuses to overwrite resources. Existing runtime archives remain untouched. See [deployment/README.md](../deployment/README.md) for inputs, matching Linux/Windows layouts, license obligations and packaged acceptance.

As the EffectStreamer Core uses GStreamer internally, the following paragraphs will lay out how to compile GStreamer and other prerequisites, as well as compiling and running EffectStreamer Core itself.

There are two important factors to consider, before starting:

- Please make sure to use Ubuntu 24.04 (or other Debian-based Linux distros) as your compiler host; We will cross-compile for Linux and Windows
- Please also make sure to work on a local filesystem, as compiling on network shares will most likely cause permission errors

### Step 1) Prepare Ubuntu

```
sudo apt-get update
sudo apt-get install python3 python3-venv git build-essential meson gcc-mingw-w64-x86-64-posix
```

### Step 2) Build GStreamer SDK

```
git clone https://git.tu-berlin.de/qu/speech-quality/effectstreamer.git EffectStreamer
cd EffectStreamer/est-core

git clone https://gitlab.freedesktop.org/gstreamer/cerbero gst-sdk
cd gst-sdk

git checkout 1.28.7
```

#### Linux

```
./cerbero-uninstalled bootstrap
./cerbero-uninstalled build gstreamer-1.0
./cerbero-uninstalled build gst-plugins-base
./cerbero-uninstalled build gst-plugins-good
./cerbero-uninstalled build gst-plugins-bad
```

#### Windows

```
./cerbero-uninstalled -c config/cross-win64.cbc bootstrap
./cerbero-uninstalled -c config/cross-win64.cbc build gstreamer-1.0
./cerbero-uninstalled -c config/cross-win64.cbc build gst-plugins-base
./cerbero-uninstalled -c config/cross-win64.cbc build gst-plugins-good
./cerbero-uninstalled -c config/cross-win64.cbc build gst-plugins-bad
```

### Step 3) Build EffectStreamer Core with GStreamer linking

The reproducible build script runs the compiler commands below without replacing tracked binaries:

```bash
SDK=/absolute/path/to/gst-sdk/build/dist/linux_x86_64 TARGET_OS=linux bash build_scripts/build.sh
SDK=/absolute/path/to/gst-sdk/build/dist/mingw_x86_64 TARGET_OS=win bash build_scripts/build.sh
```

Outputs default to `/tmp/effectstreamer/<user>/<checkout>/est-core/build/linux/est-core` and the corresponding `build/win/est-core.exe`. Query the exact path with `bash ../est-common/transient-paths.sh path est-core build linux est-core` from `est-core`. `EST_CORE_OUTPUT` and the test-home override `EST_TEST_TMP` must remain inside this checkout's managed temporary namespace. Build locks reject concurrent writes to the same target. The standalone C build does not require Node.js, can run from any working directory, and never copies or deletes SDK/runtime inputs.

Prefer the script above to hand-maintained compiler commands: it includes the standalone transient-cache initializer and directs compiler scratch into the managed tree. The executable initializes its own temporary/GStreamer registry paths before GStreamer starts, even without a Node host. WAV destinations remain persistent; native recordings write directly to their WAV filenames and are finalized during normal shutdown, not atomically renamed.

### Step 4) Bundle EffectStreamer NetSim Plugin

The EffectStreamer NetSim plugin is being discovered and loaded in by GStreamer at runtime. It does not need to be linked into `est-core`, but the matching plugin artifact must be copied into the bundled GStreamer plugin directory.

However, make sure the `estnetsim` plugin `.so` and `.dll` artifacts were built against the same GStreamer SDK version and target architecture as `est-core`.

Use the Node runtime assembler with the matching `SDK`, `EST_NETSIM_PLUGIN` and source-built `EST_CORE_EXECUTABLE` inputs; see [deployment/README.md](../deployment/README.md). It copies directly into a **new final** core-resource directory, refuses existing destinations, and records input hashes. There is no intermediate publication directory. A failed copy may leave partial resources; inspect/remove only that failed output or choose another new destination before retrying. Node is needed for packaging, not for the C-only build.

### Step 5) Run EffectStreamer Core

Run from the assembled distribution's core directory, not a source-tree binary. Transfer the complete assembled runtime; its SDK library aliases are dereferenced so they do not point back to the build host. Removing temporary build/cache files does not remove this final distribution or persistent recordings.

#### Linux

```
export LD_LIBRARY_PATH=$(pwd)/gst-lib/x86_64-linux-gnu/lib/${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export GST_PLUGIN_PATH=$(pwd)/gst-lib/x86_64-linux-gnu/lib/gstreamer-1.0
./est-core
```

#### Windows

```
set "PATH=%CD%\gst-lib\x86_64-windows\bin;%PATH%"
set "GST_PLUGIN_PATH=%CD%\gst-lib\x86_64-windows\lib\gstreamer-1.0"
.\est-core.exe
```
