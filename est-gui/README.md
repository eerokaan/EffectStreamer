# EffectStreamer GUI

## Introduction

This is the EffectStreamer GUI – the participant-facing interface of EffectStreamer, guiding participants through the experiment and collecting their evaluations and audio.

## Usage

EffectStreamer GUI is distributed as a packaged Electron application. It connects to the EffectStreamer Server and starts the bundled EffectStreamer Core processes when the server requests an audio condition.

Before starting the GUI, place an `est-config.json` file next to the packaged application binary and adjust it for the client machine:

```
{
    "server": {
        "ipAddress": "127.0.0.1",
        "port": "3000"
    },
    "client": {
        "ipAddress": "127.0.0.1",
        "audioDevices": {
            "source": "hw:0,0",
            "sink": "hw:0,0"
        }
    }
}
```

The `server` section points to the running EffectStreamer Server. The `client.ipAddress` value is the IP address under which this GUI client should register itself at the server. On Linux, `client.audioDevices.source` and `client.audioDevices.sink` should be ALSA device IDs, for example values from `arecord -l` and `aplay -l`. On Windows, these device values can usually be left empty in the server-side setup because EffectStreamer Core can automatically select WASAPI devices.

### Linux

Make the AppImage executable and start it with:

```
chmod +x EffectStreamer_GUI*.AppImage
./EffectStreamer_GUI*.AppImage
```

For AppImage builds, the GUI reads `est-config.json` from the same directory as the `.AppImage` file.

### Windows

Run the installer `EffectStreamer_GUI_.exe` and start EffectStreamer from the Start Menu or the installed executable.

For packaged Windows builds, the GUI reads `est-config.json` from the same directory as the installed `.exe` file. In almost all cases this would be under `C:\Program Files\EffectStreamer`.

## Compilation

EffectStreamer GUI is packaged with `electron-builder`. Before packaging, make sure the EffectStreamer Core build artifacts are available in `est-gui/build/linux` or `est-gui/build/win` respectively. EffectStreamer GUI was build using Node.js v22.22.3 and NPM v10.9.8. As of May 2026, Node v24/NPM v11 is producing errors when trying to fetch Electron.

To create the Linux AppImage:

```
npm install
npm run build:linux
```

The AppImage will be written to `est-gui/dist`.

To create the Windows NSIS installer:

```
apt-get install wine
ln -s /usr/bin/wine /usr/local/bin/wine64

npm install
npm run build:win
```

The NSIS installer will be written to `est-gui/dist`.
