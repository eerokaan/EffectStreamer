# EchoStreamer – Core

This is the EchoStreamer core – a standalone application which allows for the same VoIP echo tests to be held, as the previous script-based EchoStreamer. However the EchoStreamer core is not dependent on a GStreamer instance installed on the host system, as EchoStreamer core comes with its own dynamically linked GStreamer. Moreover, the EchoStreamer core is able to be cross-compiled to Linux and Windows at the same time, while also taking care of audio server differences (ALSA vs. WASAPI2); this allows the EchoStreamer core to be embedded into other applications (hence the naming "Core").

In the following README, is is explained how to compile GStreamer and other prerequisites, aswell as then compiling and running EchoStreamer. There are two important factors to consider, before starting:

- Please make sure to use Ubuntu 24.04 (or other Debian-based Linux distros) as your compiler host
- Please also make sure to work on a local filesystem, as compiling on network shares will most likely cause permission errors

## Step 1) Prepare Ubuntu

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

## Step 2) Build GStreamer with necessary plugins

```
git clone https://git.tu-berlin.de/qu/speech-quality/echostreamer.git EchoStreamer
cd EchoStreamer

git checkout est-core
git clone https://gitlab.freedesktop.org/gstreamer/cerbero gst-sdk

cd gst-sdk
git checkout 1.28.0
```

### Linux

```
./cerbero-uninstalled bootstrap
./cerbero-uninstalled build gstreamer-1.0
./cerbero-uninstalled build gst-plugins-base
./cerbero-uninstalled build gst-plugins-good
./cerbero-uninstalled build gst-plugins-bad
```

### Windows

```
./cerbero-uninstalled -c config/cross-win64.cbc bootstrap
./cerbero-uninstalled -c config/cross-win64.cbc build gstreamer-1.0
./cerbero-uninstalled -c config/cross-win64.cbc build gst-plugins-base
./cerbero-uninstalled -c config/cross-win64.cbc build gst-plugins-good
./cerbero-uninstalled -c config/cross-win64.cbc build gst-plugins-bad
```

## Step 3) Build EchoStreamer with GStreamer linking

```
cd ..
```

### Linux

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

### Windows

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

## Step 4) Run EchoStreamer

Notice: Always `tar` the `gst-lib` directory when transferring it between machines. The symbolic link structure inside it can easily become corrupted when moving across different machines or platforms.

### Linux

```
export LD_LIBRARY_PATH=$(pwd)/gst-lib/x86_64-linux-gnu/lib/${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export GST_PLUGIN_PATH=$(pwd)/gst-lib/x86_64-linux-gnu/lib/gstreamer-1.0
./est-core
```

### Windows

```
set "PATH=%CD%\gst-lib\x86_64-windows\bin;%PATH%"
set "GST_PLUGIN_PATH=%CD%\gst-lib\x86_64-windows\lib\gstreamer-1.0"
.\est-core.exe
```
