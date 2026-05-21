# EffectStreamer Server

## Introduction

This is the EffectStreamer Server – it orchestrates the entire experiment; managing state, coordinating all connected participants, collecting evaluation data, and serving as the single source of truth via a central configuration file.

## Usage

EffectStreamer Server is distributed as a standalone Node.js executable and should be started before the GUI clients connect. Before starting the server, place an `est-config.json` file next to the server executable and adjust it for your needs. This how this file may look like:

```
{
    "server": {
        "ipAddress": "0.0.0.0",
        "port": "3000"
    },
    "tests": {
        "short-conversation-test": true,
        "listening-speaking-test": true
    },
    "conditions": {
        "baseline": [{ "nativeDelay": "0", "nativeGain": "1.0", "echoDelay": "20", "echoGain": "0.002" }],
        "random": [
            { "nativeDelay": "0", "nativeGain": "1.0", "echoDelay": "50", "echoGain": "0.03" },
            { "echoDelay": "100", "echoGain": "0.1" }
        ]
    }
}
```

You can use the following impairment parameters: `nativeDelay`, `nativeGain`, `echoDelay`, `echoGain`, `packetlossType`, `packetlossRatio`, `packetlossSeed`, `packetlossBurstModel`, `packetlossBurstRatio`.

The `server.ipAddress` and `server.port` values define where the server listens for GUI clients.

The `tests` values define which test types are included in the experiment flow; set `short-conversation-test` or `listening-speaking-test` to `false` to skip that test type for every condition.

The `conditions.baseline` runs as a first condition to establish a baseline for the participants. Afterwards, the server continues from a random condition within `conditions.random` and sequentially proceeds from there in the following rounds (ITU-T P.804: "The order of the dimension scales is permuted for each participant"). Currently the impairment parameters `nativeDelay`, `nativeGain`, `echoDelay`, and `echoGain` are supported. If a parameter is omitted, est-core applies its default value; see the [est-core README](../est-core/README.md) for details. In the configuration example above, the second random condition omits `nativeDelay` and `nativeGain`, so their defaults are used instead.

The server writes session data to `~/effectstreamer`. Each experiment run receives a new numbered session directory containing submitted forms, scale results, condition settings, and transferred audio recordings.

### Linux

Make the server executable and start it with:

```
chmod +x est-server
EST_SERVER_TYPE=harness ./est-server
```

### Windows

Start the server from a command prompt with:

```
set "EST_SERVER_TYPE=harness"
est-server.exe
```

## Compilation

EffectStreamer Server is packaged as a Node.js SEA executable. The build first bundles the JavaScript application with `ncc`, then injects the generated SEA blob into a Node.js executable with `postject`.

To create the Linux executable:

```
npm install
npm run build:linux
```

The Linux executable and a copy of `est-config.json` will be written to `est-server/dist`.

To create the Windows executable:

```
npm install
npm run build:win
```

The Windows executable and a copy of `est-config.json` will be written to `est-server/dist`.
