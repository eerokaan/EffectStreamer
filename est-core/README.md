# EffectStreamer – Core

## Introduction

This is the EffectStreamer Core – a standalone application which allows for VoIP conversations to be held under different impairment type conditions.

Currently these impairments are supported:

```
native-delay (TBD)
native-gain (TBD)
echo-delay
echo-gain
packetloss-type (TBD)
packetloss-amount (TBD)
```

Moreover, the EffectStreamer Core is able to be cross-compiled to Linux and Windows at the same time, while also taking care of audio server differences (ALSA vs. WASAPI2); this allows the EffectStreamer Core to be embedded into other applications, like it is done with EffectStreamer GUI (hence the naming "Core").

## Usage

To use EffectStreamer Core itself, without the usual wrapping inside EffectStreamer GUI, one has to handle the CLI parameters manually.

```
Sender mode:
./est-core --mode sender [--device <DEVICE-ID>] --peerip <IP-ADDRESS> --echo-delay <MS>

Receiver mode:
./est-core --mode receiver [--device <DEVICE-ID>] --echo-gain <NUMBER-BETWEEN-0-AND-1>
```

As you can see, EffectStreamer Core is split up into two modes of operation: `sender` and `receiver`. The sender deals with capturing audio from a source (e.g. a microphone), forking the signal out and then streaming them off to different destinations, while the receiver deals with the receiving of said audio streams and routing them to different sinks again (e.g. headphones, audiofile for recording, etc.). Regarding the impairment types, the sender side is responsible for the echo-delay, while the receiver deals with the echo-gain.

Following this architecture, each peer has to run a sender and receiver instance each. It is important to start the senders on both peers first, before starting the receivers, to ensure established audio streaming to which the receivers can hook into.

On Linux use the ALSA audio server `arecord -l` and `aplay -l` commands to find out the device id of your source (e.g. microphone) and sink devices (e.g. headphones) respectively. For example, the console output of `Karte 0: AudioPCI [Ensoniq AudioPCI], Gerät 1: ES1371/2 [ES1371]` would translate to the device id `hw:0,1`. Here, the device ids are mandatory to specify.

On Windows, EffectStreamer Core supports automatically fetching the source and sink device ids, as WASAPI device ids are much harder to find out compared to ALSA device ids on Linux. Here, the device ids are optional to specify.

## Compilation

As the EffectStreamer Core uses GStreamer internally, the following paragraphs will lay out how to compile GStreamer and other prerequisites, as well as compiling and running EffectStreamer itself. There are two important factors to consider, before starting:

- Please make sure to use Ubuntu 24.04 (or other Debian-based Linux distros) as your compiler host
- Please also make sure to work on a local filesystem, as compiling on network shares will most likely cause permission errors

### Step 1) Prepare Ubuntu

```
sudo -i
cd ~

dpkg --add-architecture i386
echo "check_certificate=off" >> ~/.wgetrc
ln -s /usr/bin/wine /usr/local/bin/wine64

apt-get -y update
apt-get -y upgrade
apt-get -y install python3 python3-venv git
apt-get -y install build-essential gcc-mingw-w64-x86-64-posix
```

### Step 2) Build GStreamer with necessary plugins

```
git clone https://git.tu-berlin.de/qu/speech-quality/effectstreamer.git EffectStreamer
cd EffectStreamer/est-core

git clone https://gitlab.freedesktop.org/gstreamer/cerbero gst-sdk
cd gst-sdk

git checkout 1.28.0
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

### Step 3) Build EffectStreamer with GStreamer linking

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
    est-src/main.c \
    est-src/sender.c \
    est-src/receiver.c \
    est-src/deviceutils.c \
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
    est-src/main.c \
    est-src/sender.c \
    est-src/receiver.c \
    est-src/deviceutils.c \
    $(pkg-config --cflags --libs gstreamer-1.0)
```

### Step 4) Run EffectStreamer

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
