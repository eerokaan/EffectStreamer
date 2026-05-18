# EffectStreamer

## Introduction

Welcome to the EffectStreamer repository.

EffectStreamer (abbreviated to `est`) is a research tool for systematically testing VoIP conversations under varying impairment conditions, where two peers converse with each other across a series of these conditions and rate their experience after each one, enabling structured and reproducible data collection from real-world conversations.

## Architecture

EffectStreamer consists of three parts, which work together to archieve this goal: The [**est-core**](./est-core/README.md), [**est-gui**](./est-gui/README.md) and [**est-server**](./est-server/README.md).

`est-core` is the heart of EffectStreamer - a self-contained executable available for both Linux and Windows machines that houses all of the streaming logic. This includes capturing audio from source devices, sending and receiving audio streams across peers, and playing back audio to sink devices, all while dealing with the respective audio drivers on the host system.

`est-gui` is the participant-facing interface of EffectStreamer - an Electron application available for both Linux and Windows machines that serves as a testing harness, bundling `est-core` to facilitate the actual conversations. This includes informing participants about the experiment structure, guiding them through the conversation tests (_Short Conversation Tests_ and _Listening/Speaking Tests_), collecting their evaluations on the respective rating scales, and capturing their microphone and headphone audio.

`est-server` is the orchestrating backbone of EffectStreamer - a central server application that drives the experiment flow and enforces consistent test behaviour across all connected participants. It acts as the authoritative state manager, commanding each participant's `est-gui` to display the appropriate view at any given time, as well as instructing the bundled `est-core` instances to start streaming with the correct impairment attribute values. Beyond coordinating the experiment in real time, `est-server` also collects all evaluation data, including rating scale responses and recorded audio files. The exact conditions to be tested are defined in a central configuration file on the server side, making `est-server` the single source of truth for the entire experiment.

All three components are distributed as fully freestanding executables, requiring no additional dependencies to be installed on the host system. This allows all components to be deployed and run out of the box on both Linux and Windows machines.

## Contact Info

For any further assistance and inquiries, please do not hesitate to contact Eero Kaan at [eerokaan@qu.tu-berlin.de](mailto:eerokaan@qu.tu-berlin.de).

EffectStreamer was build at the Quality and Usability Lab / TU Berlin.
