# EchoStreamer – Core

This is the EchoStreamer Core – a simple cross-compilable application written in C. It archives the same functionality as the previous script-based EchoStreamer but also allows for cross-platform usage and, more importantly, enables being embedded into a GUI application (e.g. Electron) which would be the next development step.

## How to compile EchoStreamer with (dynamically linked and local) GStreamer

There are two prerequisites:

- You are running Ubuntu 24.04
- Make sure to work from a local filesystem; compiling on network shares will lead to errors

### Prepare Ubuntu

```
sudo -i
cd ~

apt-get -y update
apt-get -y upgrade
apt-get -y install python3 python3-venv git
```

### Build GStreamer with necessary plugins

```
git clone https://git.tu-berlin.de/qu/speech-quality/echostreamer.git EchoStreamer
cd EchoStreamer

git checkout es-core
git clone https://gitlab.freedesktop.org/gstreamer/cerbero gst-sdk

cd gst-sdk
git checkout 1.28.0

./cerbero-uninstalled bootstrap
./cerbero-uninstalled build gstreamer-1.0
./cerbero-uninstalled build gst-plugins-base
./cerbero-uninstalled build gst-plugins-good
./cerbero-uninstalled build gst-plugins-bad
```

### Build EchoStreamer with GStreamer linking

```
cd ..

export SDK=/root/EchoStreamer/gst-sdk/build/dist/linux_x86_64
export LIBRARY_PATH=$SDK/lib/x86_64-linux-gnu
export PKG_CONFIG_PATH=$SDK/lib/x86_64-linux-gnu/pkgconfig

gcc -o gst_test gst_test.c \
    $(pkg-config --cflags --libs gstreamer-1.0) \
    -Wl,-rpath-link,$LIBRARY_PATH \
    -Wl,-rpath,'$ORIGIN/gst-lib'
```

### Prepare EchoStreamer for first run

```
mkdir gst-lib
cp -a $SDK/lib/x86_64-linux-gnu gst-lib/
```

### Run EchoStreamer

```
export LD_LIBRARY_PATH=$(pwd)/gst-lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
export GST_PLUGIN_PATH=$(pwd)/gst-lib/x86_64-linux-gnu/gstreamer-1.0

./gst_test
```
