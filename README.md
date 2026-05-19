# EffectStreamer Script

This is the EffectStreamer Script branch. Pipeline implementations for `est-core` are tested here via the GStreamer `gst-launch-1.0` binary before being ported to C code. This allows for faster testing and development.

GStreamer is not used in a bundled form here, as it is in `est-core`, but rather as system packages. Make sure to execute these commands on your Debian/Ubuntu machine before starting:

```
sudo -i

apt-get -y update
apt-get -y upgrade

apt-get -y install htop nano net-tools

apt-get -y install libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libgstreamer-plugins-bad1.0-dev gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav gstreamer1.0-tools gstreamer1.0-x gstreamer1.0-alsa gstreamer1.0-gl gstreamer1.0-gtk3 gstreamer1.0-qt5 gstreamer1.0-pulseaudio
```
