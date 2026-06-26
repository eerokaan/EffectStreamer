# EffectStreamer Utilities

## Introduction

EffectStreamer Utilities is not a standalone component of EffectStreamer. Rather it consists of multiple smaller helper scripts that may come in handy in different custom experiment setups.

The ALSA bridge scripts are intended for lab use and ad-hoc experiment setups where EffectStreamer needs to work with desktop-managed audio devices, such as Bluetooth headsets or earbuds. EffectStreamer itself expects ALSA device names for low-level audio input and output, while these devices are often only available through the PipeWire desktop audio stack. The bridge scripts work by loading the ALSA loopback module and use GStreamer to route audio between PipeWire and stable ALSA loopback devices that can be selected by `est-gui`.

These scripts are not a replacement for a direct ALSA setup. They require GStreamer and the relevant system audio tools to be installed system-wide, unlike `est-core`, and using PipeWire devices adds additional latency. Use direct ALSA devices whenever the experiment setup allows it, as this guarantees higher stability and lower latencies.

## Recommended Workflow

1. Pair and select the intended audio device in Ubuntu/GNOME Settings first.
2. For Bluetooth earbuds or headsets with microphones, select an HSP/HFP profile. Some models also require selecting a specific codec. For example, Apple AirPods may need HSP/HFP with the mSBC codec for both output and input.
3. Prefer keeping the current GNOME/PipeWire defaults when the script asks. The script itself also allows for manual device selection, but selecting devices, Bluetooth profiles, and codecs through GNOME/Ubuntu Settings is faster for trying out different audio settings.
4. Run `alsa-bridge-test.sh` to confirm that the selected source and sink work through the bridge. Afterwards, Close the script again.
5. Run `alsa-bridge-main.sh` to start the bridge for EffectStreamer. Let the script run in the background for as long as `est-gui` should be used.
6. Start `est-gui` while the bridge is running.

## Scripts

### alsa-bridge-test.sh

`alsa-bridge-test.sh` starts a temporary PipeWire-to-ALSA bridge and routes the selected input back to the selected output. Speak into the selected audio source. If the bridge works, you should hear yourself in the selected sink.

Use this script before starting EffectStreamer to verify that the desktop audio device, Bluetooth profile, codec, loopback device, and GStreamer pipeline are working together properly.

### alsa-bridge-main.sh

`alsa-bridge-main.sh` starts the bridge used by EffectStreamer. It exposes the selected PipeWire source and sink through ALSA loopback device names and temporarily updates the selected `est-gui` configuration so that:

- `client.audioDevices.source` points to `plughw:Loopback,1,1`.
- `client.audioDevices.sink` points to `plughw:Loopback,0,0`.

Keep this script running while using `est-gui`. Stop it with `Ctrl + C` after the session. On shutdown, it stops the bridge processes and restores the PipeWire defaults and `est-gui` audio device configuration where possible.
