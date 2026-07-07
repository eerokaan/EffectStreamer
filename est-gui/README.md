# EffectStreamer GUI

## Introduction

This is the EffectStreamer GUI – the participant-facing interface of EffectStreamer, guiding participants through the experiment and collecting their evaluations and audio.

EffectStreamer GUI is distributed as a packaged Electron application. It connects to the EffectStreamer Server and starts the bundled EffectStreamer Core processes when the server requests an audio condition.

## The configuration file

Before starting the GUI, create `~/effectstreamer/config-gui.json` for the current OS user. `config-gui.example.json` is the repository template; the application does not search for or migrate legacy adjacent configuration files:

```
{
    "server": {
        "ipAddress": "127.0.0.1",
        "port": "3000"
    },
    "client": {
        "identity": "client-a",
        "ipAddress": "127.0.0.1",
        "audioDevices": {
            "source": "default",
            "sink": "default"
        }
    }
}
```

The `server` section points to the running EffectStreamer Server. The `client.identity` value is the stable identity under which this GUI registers at the server. Configure a unique value for each participant machine, for example `client-a` on the first machine and `client-b` on the second machine. The `client.ipAddress` value is the LAN address under which this GUI client registers. Audio device values are Chromium `MediaDevices.deviceId` strings, not ALSA or WASAPI identifiers. Use `default` for the explicit system-default choice, or open the device picker with `Ctrl+Alt+O` (`Command+Alt+O` on macOS) and save a concrete device.

## Usage

### Linux

Make the AppImage executable and start it with:

```
chmod +x EffectStreamer_GUI*.AppImage
./EffectStreamer_GUI*.AppImage
```

The AppImage reads `~/effectstreamer/config-gui.json`.

### Windows

Run the installer `EffectStreamer_GUI.exe` and start EffectStreamer from the Start Menu or the installed executable.

Packaged Windows builds read `%USERPROFILE%\effectstreamer\config-gui.json`.

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
