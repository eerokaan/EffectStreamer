# EffectStreamer

## Introduction

Welcome to the EffectStreamer repository.

EffectStreamer (abbreviated to `est`) is a research toolkit for systematically testing VoIP conversations under varying impairment conditions, where two peers converse with each other across a series of these conditions and rate their experience after each one, enabling structured and reproducible data collection from real-world conversations.

The test procedure implemented in EffectStreamer follows the ITU-T Recommendation P.804, providing structured conversation tests for evaluating transmitted speech quality under repeatable impairment conditions.

## Architecture

**EffectStreamer consists of three main parts, which are explained in detail in these README files:** The [**est-core**](./est-core/README.md), [**est-gui**](./est-gui/README.md) and [**est-server**](./est-server/README.md).

`est-core` owns RTP streaming, impairment, mixing and native PCM/WAV recording. Local participants use ALSA on Linux or WASAPI2 on Windows directly; raw PCM stdio remains an optional external-host backend. Standalone WebRTC runs require a signaling host; see the [reference example](est-core/examples/webrtc-host.cjs).

`est-gui` provides one shared React participant frontend. Electron supplies local native devices/processes/files; the browser supplies remote WebRTC and in-memory WAV recording. Both use the same SCT/LST views, questionnaires, ratings and server-owned session flow. Remote participants install nothing.

`est-server` is the orchestrating backbone of EffectStreamer - a central server application that drives the experiment flow and enforces consistent test behaviour across all connected participants. It acts as the authoritative state manager, commanding each participant's `est-gui` to display the appropriate view at any given time, as well as instructing the bundled `est-core` instances to start streaming with the correct impairment attribute values. Beyond coordinating the experiment in real time, `est-server` also collects all evaluation data, including rating scale responses and recorded audio files. The exact conditions to be tested are defined in a central configuration file on the server side, making `est-server` the single source of truth for the entire experiment.

Remote deployments isolate each two-person pair in a worker with four server-hosted cores and two unidirectional browser connections per participant. Stable A/B roles are separate from Prolific identifiers. One coordinator serves the frontend, API, Socket.IO and chunk uploads at one HTTPS origin; public WebRTC media additionally needs reachable ICE/TURN endpoints, not just an HTTPS proxy.

## Running experiments

- **Local:** build/package native Linux or Windows clients, copy the server/GUI example configurations, configure `client-a`/`client-b` LAN addresses, and start the coordinator before both clients. See [server](est-server/README.md) and [GUI](est-gui/README.md) instructions. Audio setup is server-optional locally.
- **Remote:** follow [deployment/README.md](deployment/README.md) for standalone server/core/runtime packaging, DNS/TLS/TURN, Prolific URLs and operational limits. Audio setup is mandatory. Desktop/laptop Chrome, Edge, Firefox and Safari are the supported targets; phones/tablets are excluded. Automated Chromium/Firefox results do not establish real Safari/Edge or physical-device acceptance; see the [verification checklist](deployment/README.md#verification).

Both modes save `microphone.wav` and `headphones.wav` as 48 kHz mono S16LE PCM. Local taps are the core microphone and playback mix; remote taps are the original microphone stream before Opus encoding and the received decoded playback stream. They do not represent physical sound at the ears, system output-volume changes, or hardware processing. Recordings keep ordinary existing-style start/stop semantics: no extra offsets, sample-count sidecars, gap logs, synchronization, calibration or timing-analysis dataset is added.

Remote transport uses Opus/SRTP; experimental packet loss is applied to private internal L16/RTP, not encrypted Internet packets. Internal packetization targets 128 mono frames, with preserved partial packets at EOS/discontinuities. Internet delay and WebRTC concealment are additional effects, so equal impairment settings do not promise equal local/remote perceptual results or calibrated boundaries.

## Disconnection and collection

If a remote participant disconnects, EffectStreamer stops the active condition, marks that attempt incomplete, and allows a configurable reconnection window. After successful recovery, the pair retries the interrupted condition from the beginning; otherwise, the session ends through the configured early-exit path without replacing either participant. Recordings are collected after each condition and retained in browser memory until the server confirms storage, but closing or reloading the page can lose recordings that have not yet been uploaded.

Only a matching durable storage receipt releases client bytes. Coordinator restart ends active conversations through the technical-failure path; already-stopped upload contexts can reconcile using persisted credentials, manifests, deadlines and receipts when the scientific configuration is unchanged.

## Generated files and saving policy

Disposable builds, tool caches, packaging inputs, test fixtures/reports and runtime caches use `/tmp/effectstreamer/<user>/<checkout-or-installation>/<component>/` on Linux. Native Windows uses its system temporary directory's `effectstreamer` subtree; Linux-hosted Windows cross-builds still use `/tmp/effectstreamer`. Separate checkouts and test runs are isolated. Installed dependencies/SDKs, final `dist` outputs, configuration, credentials, recordings and study results remain persistent.

From the repository root, query default build paths without creating files:

```bash
bash common/transient-paths.sh path est-core build linux est-core
bash common/transient-paths.sh path est-core build win est-core.exe
bash common/transient-paths.sh path est-gui web
```

All project-owned saves write directly to their destinations, including JSON, uploaded WAVs and package resources. There are no new atomic-save `.tmp` files or upload `.part` files. **An interrupted write can leave truncated JSON, an incomplete WAV, or a partial distribution.** A WAV filename alone does not establish completion: validation and matching storage receipts remain required. Existing legacy partial uploads are reconciled without discarding their source before successful receipt/session persistence.

After temporary storage is cleared, rebuild before running tests or packaging that need compiled inputs. Producers recreate their transient directories; persistent application data must never be configured below the disposable root. `/tmp` is not universally cleared on reboot: see the optional Linux boot-cleanup [rule](common/effectstreamer-tmpfiles.conf) and [installation instructions](deployment/README.md#temporary-files). No cleanup service is installed automatically.

## Contact Info

For any further assistance and inquiries, please do not hesitate to contact Eero Kaan at [eerokaan@qu.tu-berlin.de](mailto:eerokaan@qu.tu-berlin.de).

EffectStreamer was developed at the Quality and Usability Lab at TU Berlin.
