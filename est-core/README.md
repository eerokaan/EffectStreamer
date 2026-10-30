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

`--device-type` is required. Linux accepts `alsa` and `stdio`; Windows accepts `wasapi2` and `stdio`. `--device-id` is optional for host backends and is invalid for `stdio`. If a host device ID is omitted, the first matching source in sender mode or sink in receiver mode is selected. Device IDs are backend identifiers such as ALSA `hw:0,1` or a WASAPI2 endpoint ID, not display labels.

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

Each peer runs one sender and one receiver. Start both senders before the receivers so the receiver streams are available when playback and recording begin. The sender applies native delay, echo delay, and peer-branch packet loss. The receiver applies native and echo gain and records `microphone.ogg` and `headphones.ogg` under `~/effectstreamer`.

For ALSA device IDs, use `arecord -l` for sources and `aplay -l` for sinks. For example, card 0, device 1 maps to `hw:0,1`. WASAPI2 endpoint IDs can normally be omitted and auto-detected.

Managed native hosts can add `--control ndjson`. Standard input/output then contain only version-1 NDJSON requests/replies/events; diagnostic logs remain on stderr. `--control none` is the standalone default. Never enable NDJSON with `--device-type stdio`, which retains raw F32LE PCM pipes.

After the `control-ready` event, send `{ "version": 1, "type": "request", "id": "start-1", "command": "audio.start", "payload": {} }`. `audio.stop` or `shutdown` requests EOS and a bounded graceful exit; stdin EOF has the same stop behavior. Wait for `recording-finalized` and successful process exit before collecting native recordings. `media-ready` indicates an observed media buffer, not merely control readiness or a start acknowledgement. The shared Node host is `@effectstreamer/common/core-process`.

## Compilation

As the EffectStreamer Core uses GStreamer internally, the following paragraphs will lay out how to compile GStreamer and other prerequisites, as well as compiling and running EffectStreamer Core itself.

There are two important factors to consider, before starting:

- Please make sure to use Ubuntu 24.04 (or other Debian-based Linux distros) as your compiler host; We will cross-compile for Linux and Windows
- Please also make sure to work on a local filesystem, as compiling on network shares will most likely cause permission errors

### Step 1) Prepare Ubuntu

```
sudo -i
cd ~

dpkg --add-architecture i386
echo "check_certificate=off" >> ~/.wgetrc

apt-get -y update
apt-get -y upgrade
apt-get -y install python3 python3-venv git
apt-get -y install build-essential meson gcc-mingw-w64-x86-64-posix
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

Outputs default to `.build/linux/est-core` and `.build/win/est-core.exe`. Override with `EST_CORE_OUTPUT` if needed. Run with the matching bundled runtime/library environment described in Step 5. The script can be invoked from any working directory and never copies or deletes SDK/runtime files.

```
cd ..
```

#### Linux

```
export SDK=$(pwd)/gst-sdk/build/dist/linux_x86_64
export PKG_CONFIG_PATH=$SDK/lib/x86_64-linux-gnu/pkgconfig
export PKG_CONFIG_SYSROOT_DIR=$SDK
export LIBRARY_PATH=$SDK/lib/x86_64-linux-gnu

mkdir -p gst-lib/x86_64-linux-gnu/bin
mkdir -p gst-lib/x86_64-linux-gnu/lib
cp -a $SDK/bin/* gst-lib/x86_64-linux-gnu/bin/
cp -a $SDK/lib/x86_64-linux-gnu/* gst-lib/x86_64-linux-gnu/lib/

gcc -o est-core \
    -Iest-src \
    -Iest-src/stdin \
    -Iest-deps/cJSON \
    est-src/main.c \
    est-src/modes/sender.c \
    est-src/modes/receiver.c \
    est-src/stdin/receiverstdin.c \
    est-src/device/deviceutils.c \
    est-src/platform/linux.c \
    est-src/control/control.c \
    est-src/lifecycle.c \
    est-deps/cJSON/cJSON.c \
    $(pkg-config --cflags --libs gstreamer-1.0) \
    -Wl,-rpath-link,$LIBRARY_PATH \
    -Wl,-rpath,'$ORIGIN/gst-lib/x86_64-linux-gnu/lib'
```

#### Windows

```
export SDK=$(pwd)/gst-sdk/build/dist/mingw_x86_64
export PKG_CONFIG_PATH=$SDK/lib/pkgconfig
export PKG_CONFIG_SYSROOT_DIR=$SDK
export LIBRARY_PATH=$SDK/lib

mkdir -p gst-lib/x86_64-windows/bin
mkdir -p gst-lib/x86_64-windows/lib
cp -a $SDK/bin/* gst-lib/x86_64-windows/bin/
cp -a $SDK/lib/* gst-lib/x86_64-windows/lib/

x86_64-w64-mingw32-gcc -o est-core.exe \
    -Iest-src \
    -Iest-src/stdin \
    -Iest-deps/cJSON \
    est-src/main.c \
    est-src/modes/sender.c \
    est-src/modes/receiver.c \
    est-src/stdin/receiverstdin.c \
    est-src/device/deviceutils.c \
    est-src/platform/windows.c \
    est-src/control/control.c \
    est-src/lifecycle.c \
    est-deps/cJSON/cJSON.c \
    $(pkg-config --cflags --libs gstreamer-1.0)
```

### Step 4) Bundle EffectStreamer NetSim Plugin

The EffectStreamer NetSim plugin is being discovered and loaded in by GStreamer at runtime. It does not need to be linked into `est-core`, but the matching plugin artifact must be copied into the bundled GStreamer plugin directory.

However, make sure the `estnetsim` plugin `.so` and `.dll` artifacts were built against the same GStreamer SDK version and target architecture as `est-core`.

#### Linux

```
cp -a libestnetsim.so gst-lib/x86_64-linux-gnu/lib/gstreamer-1.0/
```

#### Windows

```
cp -a libestnetsim.dll gst-lib/x86_64-windows/lib/gstreamer-1.0/
```

### Step 5) Run EffectStreamer Core

Notice: Always `tar` the `gst-lib` directory when transferring it between machines. The symbolic link structure inside it can easily become corrupted when moving across different machines or platforms.

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
