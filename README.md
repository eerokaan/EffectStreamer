# EffectStreamer NetSim

`estnetsim` is a GStreamer plugin for EffectStreamer packet-loss simulation. It is a transparent one-sink/one-source filter that drops incoming buffers according to random or ITU-T G.107 bursty packet-loss settings.

When simulating RTP packet loss, place `estnetsim` after the RTP payloader and before the network sink so each input buffer corresponds to one packet.

```
rtpL16pay ! estnetsim ! udpsink
```

## Build

Requirements:

```
meson
pkg-config
GStreamer 1.18 or newer development files
GStreamer runtime tools such as gst-inspect-1.0 and gst-launch-1.0
```

```
meson setup builddir
meson compile -C builddir
```

Inspect the built plugin directly:

```
gst-inspect-1.0 builddir/src/libgstestnetsim.dylib
```

Or inspect it via `GST_PLUGIN_PATH`:

```
GST_PLUGIN_PATH="$PWD/builddir/src" gst-inspect-1.0 estnetsim
```

Use the platform-specific library name if needed, for example `libgstestnetsim.so` on Linux.

## Properties

```
packetloss-type           none | random | bursty
packetloss-ratio          0.0 .. 1.0
packetloss-seed           uint, 0 means random seed per stream
packetloss-burst-model    g107-markov
packetloss-burst-ratio    >= 1.0
```

Examples:

```
GST_PLUGIN_PATH="$PWD/builddir/src" gst-launch-1.0 -q \
    fakesrc num-buffers=100 ! \
    estnetsim packetloss-type=random packetloss-ratio=0.1 packetloss-seed=1234 ! \
    fakesink
```

```
GST_PLUGIN_PATH="$PWD/builddir/src" gst-launch-1.0 -q \
    fakesrc num-buffers=100 ! \
    estnetsim packetloss-type=bursty packetloss-ratio=0.1 packetloss-seed=1234 packetloss-burst-model=g107-markov packetloss-burst-ratio=2.0 ! \
    fakesink
```

## Debugging

Use GStreamer debug categories rather than stdout logging:

```
GST_DEBUG=estnetsim:5 GST_PLUGIN_PATH="$PWD/builddir/src" gst-launch-1.0 \
    fakesrc num-buffers=20 ! estnetsim packetloss-type=random packetloss-ratio=0.5 packetloss-seed=1 ! fakesink
```
