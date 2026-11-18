# EffectStreamer

## Introduction

Welcome to the EffectStreamer repository.

EffectStreamer (abbreviated to `est`) is a research toolkit for systematically testing VoIP conversations under varying impairment conditions, where two peers converse with each other across a series of these conditions and rate their experience after each one, enabling structured and reproducible data collection from real-world conversations.

The test procedure implemented in EffectStreamer follows the ITU-T Recommendation P.804, providing structured conversation tests for evaluating transmitted speech quality under repeatable impairment conditions.

## Architecture

**EffectStreamer consists of three main parts, which are explained in detail in these README files:** The [**est-core**](./est-core/README.md), [**est-gui**](./est-gui/README.md) and [**est-server**](./est-server/README.md).

`est-core` owns RTP streaming, impairment, mixing and native PCM/WAV recording. Local participants use ALSA on Linux or WASAPI2 on Windows directly; raw PCM stdio remains an optional external-host backend. Standalone WebRTC runs require a signaling host; `est-server` supplies this for managed experiments.

`est-gui` provides one shared React participant frontend. Electron supplies local native devices/processes/files; the browser supplies remote WebRTC and in-memory WAV recording. Both use the same SCT/LST views, questionnaires, ratings and server-owned session flow. Remote participants install nothing.

`est-server` is the orchestrating backbone of EffectStreamer - a central server application that drives the experiment flow and enforces consistent test behaviour across all connected participants. It acts as the authoritative state manager, commanding each participant's `est-gui` to display the appropriate view at any given time, as well as instructing the bundled `est-core` instances to start streaming with the correct impairment attribute values. The server also collects participants' ratings and [recordings after each condition](est-server/README.md#interrupted-sessions-and-recording-collection). The exact conditions to be tested are defined in a central configuration file on the server side, making `est-server` the single source of truth for the entire experiment.

Remote deployments isolate each two-person pair in a worker with four server-hosted cores and two unidirectional browser connections per participant. Stable A/B roles are separate from Prolific identifiers. An external HTTPS server serves the browser frontend and proxies same-origin `/api/` (including uploads) and `/socket.io/` to the coordinator. Public WebRTC media also needs reachable ICE/TURN endpoints.

## Running experiments

- **Local-use:** build/package native Linux or Windows clients, start from the [local-use server example](est-server/est-server.config.local.example.json) and [Electron GUI example](est-gui/est-gui.config.example.json), configure `client-a`/`client-b` LAN addresses, and start the coordinator before both clients. See [server](est-server/README.md) and [GUI](est-gui/README.md) instructions. Audio setup is server-optional locally.
- **Remote-use:** start from the [remote-use server example](est-server/est-server.config.remote.example.json). Copy the **contents** of `est-gui/dist/web/` to the study site's HTTPS document root. Follow the [deployment guide](deployment/README.md#networking) for entry routes, WebSocket upgrades, and DNS/TLS/TURN setup. Audio setup is mandatory. Desktop/laptop Chrome, Edge, Firefox and Safari are the supported targets; phones/tablets are excluded. Automated Chromium/Firefox results do not establish real Safari/Edge or physical-device acceptance; see the [verification checklist](deployment/README.md#verification).

Runtime configuration belongs to the account running the application, not its installation directory:

| Component/use | Linux | Windows |
| --- | --- | --- |
| Server, local-use or remote-use | `~/effectstreamer/est-server.config.json` | `%USERPROFILE%\effectstreamer\est-server.config.json` |
| Electron GUI, local-use | `~/effectstreamer/est-gui.config.json` | `%USERPROFILE%\effectstreamer\est-gui.config.json` |

Copy the chosen example to its runtime filename; both server examples explicitly set `server.mode` and share the same supported settings. Remote-use browser participants need no GUI JSON file. Only the documented configuration fields are supported; unknown keys are rejected.

Both modes save `microphone.wav` and `headphones.wav` as 48 kHz mono S16LE PCM. Local taps are the core microphone and playback mix; remote taps are the original microphone stream before Opus encoding and the received decoded playback stream. They do not represent physical sound at the ears, system output-volume changes, or hardware processing.

Remote transport uses Opus/SRTP; experimental packet loss is applied to private internal L16/RTP, not encrypted Internet packets. Internal packetization targets 128 mono frames, with preserved partial packets at EOS/discontinuities. Internet delay and WebRTC concealment are additional effects, so equal impairment settings do not promise equal local/remote perceptual results or calibrated boundaries.

## Automated tests

Automated suites, fixtures, test dependencies and runner configurations live in [`test/`](test/README.md), separate from the application components. See its README for setup, native build prerequisites and per-component commands.

## Contact Info

For any further assistance and inquiries, please do not hesitate to contact Eero Kaan at [eerokaan@qu.tu-berlin.de](mailto:eerokaan@qu.tu-berlin.de).

EffectStreamer was developed at the Quality and Usability Lab at TU Berlin.
