# EchoStreamer – Core

This is the EchoStreamer Core – a simple cross-compilable application written in C. It archives the same functionality as the previous script-based EchoStreamer but also allows for cross-platform usage and, more importantly, enables being embedded into a GUI application (e.g. Electron) which would be the next development step.

## How to cross-compile EchoStreamer with dynamically linked and local GStreamer

There are two prerequisites:

- You are running Ubuntu 24.04
- Make sure to work from a local filesystem; compiling on network shares will lead to errors

### Prepare Ubuntu

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

### Build GStreamer with necessary plugins

```
git clone https://git.tu-berlin.de/qu/speech-quality/echostreamer.git EchoStreamer
cd EchoStreamer

git checkout es-core
git clone https://gitlab.freedesktop.org/gstreamer/cerbero gst-sdk

cd gst-sdk
git checkout 1.28.0
```

**Linux**

```
./cerbero-uninstalled bootstrap
./cerbero-uninstalled build gstreamer-1.0
./cerbero-uninstalled build gst-plugins-base
./cerbero-uninstalled build gst-plugins-good
./cerbero-uninstalled build gst-plugins-bad
```

**Windows**

```
./cerbero-uninstalled -c config/cross-win64.cbc bootstrap
./cerbero-uninstalled -c config/cross-win64.cbc build gstreamer-1.0
./cerbero-uninstalled -c config/cross-win64.cbc build gst-plugins-base
./cerbero-uninstalled -c config/cross-win64.cbc build gst-plugins-good
./cerbero-uninstalled -c config/cross-win64.cbc build gst-plugins-bad
```

### Build EchoStreamer with GStreamer linking

```
cd ..
```

**Linux**

```
export SDK=/root/EchoStreamer/gst-sdk/build/dist/linux_x86_64
export PKG_CONFIG_PATH=$SDK/lib/x86_64-linux-gnu/pkgconfig
export PKG_CONFIG_SYSROOT_DIR=$SDK
export LIBRARY_PATH=$SDK/lib/x86_64-linux-gnu

mkdir -p gst-lib/x86_64-linux-gnu/bin
mkdir -p gst-lib/x86_64-linux-gnu/lib
cp -a $SDK/bin/* gst-lib/x86_64-linux-gnu/bin/
cp -a $SDK/lib/x86_64-linux-gnu/* gst-lib/x86_64-linux-gnu/lib/

gcc -o gst_test gst_test_linux.c \
    $(pkg-config --cflags --libs gstreamer-1.0) \
    -Wl,-rpath-link,$LIBRARY_PATH \
    -Wl,-rpath,'$ORIGIN/gst-lib/x86_64-linux-gnu/lib'
```

**Windows**

```
export SDK=/root/EchoStreamer/gst-sdk/build/dist/mingw_x86_64
export PKG_CONFIG_PATH=$SDK/lib/pkgconfig
export PKG_CONFIG_SYSROOT_DIR=$SDK
export LIBRARY_PATH=$SDK/lib

mkdir -p gst-lib/x86_64-windows/bin
mkdir -p gst-lib/x86_64-windows/lib
cp -a $SDK/bin/* gst-lib/x86_64-windows/bin/
cp -a $SDK/lib/* gst-lib/x86_64-windows/lib/

x86_64-w64-mingw32-gcc -o gst_test.exe gst_test_windows.c \
    $(pkg-config --cflags --libs gstreamer-1.0)
```

### Run EchoStreamer

**Linux**

```
export LD_LIBRARY_PATH=$(pwd)/gst-lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export GST_PLUGIN_PATH=$(pwd)/gst-lib/x86_64-linux-gnu/lib/gstreamer-1.0
./gst_test
```

**Windows**

```
set "PATH=%CD%\gst-lib\x86_64-windows\bin;%PATH%"
set "GST_PLUGIN_PATH=%CD%\gst-lib\x86_64-windows\lib\gstreamer-1.0"
gst_test.exe"
```
