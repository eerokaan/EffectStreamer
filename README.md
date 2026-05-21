# EffectStreamer NetSim

EffectStreamer NetSim (abbreviated to `estnetsim`) is a custom GStreamer plugin for simulating different packet-loss scenarios within EffectStreamer Core. It is a transparent one-sink/one-source filter that drops incoming buffers according to random or bursty (Markov / ITU-T G.107) packet-loss settings.

When simulating RTP packet loss, place `estnetsim` after the RTP payloader and before the network sink so each input buffer corresponds to one packet.

```
rtpL16pay ! estnetsim ! udpsink
```

## Properties

```
packetloss-type           none | random | bursty
packetloss-ratio          0.0 - 1.0
packetloss-seed           uint (0 means random seed per stream)
packetloss-burst-model    g107-markov
packetloss-burst-ratio    1.0 - 8.0
```

## Compilation

EffectStreamer NetSim is built as a GStreamer plugin, not as a standalone application. The following steps build a matching GStreamer SDK for Linux and Windows, compile the `estnetsim` shared library against that SDK, and install the plugin into the SDK plugin directory so GStreamer can discover it.

There are two important factors to consider, before starting:

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
apt-get -y install meson ninja-build pkg-config wine
```

### Step 2) Build GStreamer SDK

EffectStreamer NetSim only links against the GStreamer core library. If your test pipeline needs elements from `gst-plugins-base`, `gst-plugins-good` or `gst-plugins-bad`, build those Cerbero recipes as well.

```
cd /path/to/estnetsim

git clone https://gitlab.freedesktop.org/gstreamer/cerbero gst-sdk
cd gst-sdk

git checkout 1.28.0
```

#### Linux

```
./cerbero-uninstalled bootstrap
./cerbero-uninstalled build gstreamer-1.0
```

#### Windows

```
./cerbero-uninstalled -c config/cross-win64.cbc bootstrap
./cerbero-uninstalled -c config/cross-win64.cbc build gstreamer-1.0
```

### Step 3) Build and install the plugin

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

meson setup build-linux --prefix=$(pwd)/gst-lib/x86_64-linux-gnu --libdir=lib
meson compile -C build-linux
meson install -C build-linux
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
```

Create `cross-win64.ini` in the project directory. Replace `/path/to/estnetsim` with the absolute path to this repository.

```
[binaries]
c = 'x86_64-w64-mingw32-gcc'
ar = 'x86_64-w64-mingw32-ar'
strip = 'x86_64-w64-mingw32-strip'
pkg-config = 'pkg-config'

[properties]
needs_exe_wrapper = true
sys_root = '/path/to/estnetsim/gst-sdk/build/dist/mingw_x86_64'
pkg_config_libdir = '/path/to/estnetsim/gst-sdk/build/dist/mingw_x86_64/lib/pkgconfig'

[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
```

```
meson setup build-win64 --cross-file cross-win64.ini --prefix=$(pwd)/gst-lib/x86_64-windows --libdir=lib
meson compile -C build-win64
meson install -C build-win64
```

### Step 4) Inspect estnetsim

#### Linux

```
export PATH=$(pwd)/gst-lib/x86_64-linux-gnu/bin:$PATH
export LD_LIBRARY_PATH=$(pwd)/gst-lib/x86_64-linux-gnu/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export GST_PLUGIN_PATH=$(pwd)/gst-lib/x86_64-linux-gnu/lib/gstreamer-1.0
gst-inspect-1.0 estnetsim
```

#### Windows

```
set "PATH=%CD%\gst-lib\x86_64-windows\bin;%PATH%"
set "GST_PLUGIN_PATH=%CD%\gst-lib\x86_64-windows\lib\gstreamer-1.0"
gst-inspect-1.0 estnetsim
```

### Step 5) Test out estnetsim

Run an example pipeline with random packet loss:

```
gst-launch-1.0 -q \
    fakesrc num-buffers=100 ! \
    estnetsim packetloss-type=random packetloss-ratio=0.1 packetloss-seed=1234 ! \
    fakesink
```

Run an example pipeline with bursty packet loss:

```
gst-launch-1.0 -q \
    fakesrc num-buffers=100 ! \
    estnetsim packetloss-type=bursty packetloss-ratio=0.1 packetloss-seed=1234 packetloss-burst-model=g107-markov packetloss-burst-ratio=2.0 ! \
    fakesink
```

Use GStreamer debug categories rather than stdout logging:

```
GST_DEBUG=estnetsim:5 gst-launch-1.0 \
    fakesrc num-buffers=20 ! estnetsim packetloss-type=random packetloss-ratio=0.5 packetloss-seed=1 ! fakesink
```
