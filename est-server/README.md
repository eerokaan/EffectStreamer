# EffectStreamer Server

## Introduction

This is the EffectStreamer Server – it orchestrates the entire experiment; managing state, coordinating all connected participants, collecting evaluation data, and serving as the single source of truth via a central configuration file.

The server writes to `~/effectstreamer/sessions` on Linux or `%USERPROFILE%\effectstreamer\sessions` on Windows. Each pair has a UUID directory with `session.json`, condition settings/forms/ratings, and recording attempts under `attempts/<attemptId>/<participantId>/{microphone,headphones}.wav`. New session manifests and enrollments record `sessionLanguage`. `enrollments.json` stores stable identities and hashed reconnect credentials; chunk/receipt bookkeeping allows retries.

Application files are saved directly to their destinations. Upload chunks go directly to the final WAV path; a partial or invalid WAV can exist there before completion. Format/size/checksum validation and persisted storage receipts—not filename existence—gate completion and client cleanup. Interrupted JSON/WAV writes can leave corrupt or incomplete data; keep study data on persistent storage and back it up. Stored enrollments require a finite, nonnegative integer `admissionLastActiveAt`; invalid records fail startup without being rewritten.

EffectStreamer Server is distributed as a standalone Node.js executable and should be started before the GUI clients connect.

## The configuration file

Before starting the server, choose the example for your intended use:

- **Local-use:** `est-server.config.local.example.json` for participants using native Electron clients.
- **Remote-use:** `est-server.config.remote.example.json` for participants using browsers.

Both examples expose the same settings in the same order: `server`, `remote`, `prolific`, `sessions`, `tests`, `conditions`, `pretestForm`. Set `server.mode` to `local` or `remote`; local-use disables recruitment and optionally audio setup. Copy the selected example to the runtime location and adjust it for your needs:

| Platform | Server configuration, local-use or remote-use |
| --- | --- |
| Linux | `~/effectstreamer/est-server.config.json` |
| Windows | `%USERPROFILE%\effectstreamer\est-server.config.json` |

The home directory belongs to the account running the server, which may be a service account. Remote-use browser participants need no GUI configuration file.

For remote-use, replace study IDs/codes/DNS and provide a private TURN secret before deployment. The coordinator serves only the API and Socket.IO; it neither packages nor serves the frontend. Publish the contents of `est-gui/dist/web/` at the external HTTPS document root and proxy same-origin `/api/` (including uploads) and `/socket.io/` to the coordinator. See [deployment networking](../deployment/README.md#networking) for entry routes and WebSocket upgrade configuration.

For local-use on Linux:

```bash
mkdir -p ~/effectstreamer
cp est-server.config.local.example.json ~/effectstreamer/est-server.config.json
```

For remote-use on Linux:

```bash
mkdir -p ~/effectstreamer
cp est-server.config.remote.example.json ~/effectstreamer/est-server.config.json
```

An example local-use configuration looks like this:

```
{
    "server": {
        "ipAddress": "0.0.0.0",
        "port": 3000,
        "mode": "local",
        "maxActivePairs": 1
    },
    "remote": {
        "icePortRange": [50000, 59999],
        "iceServers": [],
        "turnUrls": [],
        "turnSecret": ""
    },
    "prolific": {
        "enabled": false,
        "studyId": "",
        "completionCodes": { "completed": "", "technicalFailure": "", "partnerLeft": "", "waitingTimeout": "" },
        "secureUrls": false,
        "externalStudyUrl": "",
        "workspaceId": "",
        "organisationId": null
    },
    "sessions": {
        "general": {
            "language": "de",
            "audioSetup": false
        },
        "tests": {
            "short-conversation-test": true,
            "listening-speaking-test": true
        },
        "operatingLimits": {
            "pairingTimeoutSeconds": 300,
            "reconnectGraceSeconds": 60,
            "maxConditionSeconds": 600,
            "maxRetries": 1
        }
    },
    "conditions": {
        "baseline": [{ "nativeDelay": "0", "nativeGain": "1.0", "echoDelay": "20", "echoGain": "0.002" }],
        "random": [
            { "nativeDelay": "0", "nativeGain": "1.0", "echoDelay": "50", "echoGain": "0.03" },
            { "echoDelay": "100", "echoGain": "0.1" }
        ]
    },
    "pretestForm": [
        {
            "name": "input-age",
            "type": "input",
            "inputType": "number",
            "label": "Age",
            "description": "How old are you?",
            "placeholder": "Please specify",
            "required": true,
            "layoutWidth": 6,
            "validation": { "valueType": "integer", "min": 0 }
        },
        {
            "name": "select-gender",
            "type": "select",
            "label": "Gender",
            "placeholder": "Please specify",
            "required": true,
            "layoutWidth": 6,
            "options": [
                { "value": "female", "label": "Female" },
                { "value": "male", "label": "Male" },
                { "value": "no-choice", "label": "Prefer not to say" }
            ]
        },
        {
            "name": "slider-experience",
            "type": "slider",
            "label": "Previous experience with voice or video calls",
            "required": false,
            "layoutWidth": 12,
            "validation": { "min": 0, "max": 100, "step": 1 },
            "defaultValue": 50,
            "marks": { "minLabel": "Not experienced", "maxLabel": "Very experienced" }
        },
        {
            "name": "switch-prior-experience",
            "type": "switch",
            "label": "Any previous experience?",
            "description": "Have you ever taken part in a listening test or experiment?",
            "required": false,
            "layoutWidth": 6,
            "defaultValue": false
        }
    ]
}
```

### Server config

The `server` values define where the server listens for `est-gui` clients. `ipAddress` must be an IPv4 or IPv6 address and `port` must be an integer from `1` through `65535`. Ports supplied as numeric strings are normalized to numbers.

`mode` selects native clients (`local`) or browser clients (`remote`). `maxActivePairs` limits simultaneous pairs (integer `1`–`1000`, default `1`); it is not a measured capacity guarantee. Run one coordinator per results directory.

### Remote config

Only deployment networking is configurable here: `icePortRange` is the public UDP range for core ICE candidates; `iceServers` contains objects with `urls` (a URL string or list); `turnUrls` lists the TURN UDP/TCP/TLS endpoints; `turnSecret` is the private shared secret used to generate expiring credentials. The ICE range must not overlap the fixed private RTP range `40000`–`49999`. Local-use retains these same fields with empty server/URL lists.

### Prolific config

`enabled`, `studyId`, and the four `completionCodes` configure recruitment and outcomes. `secureUrls`, `externalStudyUrl`, `workspaceId`, and `organisationId` configure optional signed entry URLs; see [local and remote controls](#local-and-remote-controls). Local-use sets `enabled` to `false`. Remote HTTP enrollment requires Prolific.

### Sessions config

| Parameter | Meaning |
| --- | --- |
| `general.language` | **Required.** Exactly `en` (English) or `de` (German), for all participants in both modes. |
| `general.audioSetup` | Boolean. Defaults to `false` locally and `true` remotely; cannot be `false` remotely. |
| `tests.short-conversation-test` | **Required boolean.** Enables the short conversation test. |
| `tests.listening-speaking-test` | **Required boolean.** Enables the listening/speaking test. |
| `operatingLimits.pairingTimeoutSeconds` | Pre-pair inactivity/ready-queue timeout; default `300` seconds. |
| `operatingLimits.reconnectGraceSeconds` | Reconnection grace; default `60` seconds. |
| `operatingLimits.maxConditionSeconds` | Maximum condition duration; integer `1`–`11045`, default `600`. |
| `operatingLimits.maxRetries` | Condition retries after interruption; integer `0`–`10`, default `1`. |

Set `sessions.general.language` explicitly in the server config. Missing, null or unsupported values prevent startup. The server reads it at startup and publishes it as `sessionLanguage` in `/api/config`; query strings, browser locale and GUI configuration cannot override it. Changing the language requires a server restart between studies. Pairing and reconnect durations must be whole seconds between `1` and `2147483`.

All clients derive the audio-check sample from the study language: `P501_C_english_f1_FB_48k.wav` for `en` and `P501_C_german_f1_FB_48k.wav` for `de`. There is no filename override or fallback to the other language. This does not change live audio or recordings.

An open, unpaired enrollment with a different or missing language prevents startup before enrollment state is written. To preserve unfinished setup and questionnaires, finish the study with its original settings and release. Finished enrollments do not block startup. An incompatible unfinished pair ends with `technicalFailure` and keeps its original manifest language. See [Starting a new study](../deployment/README.md#starting-a-new-study) for archiving instructions. Deploy the server, web assets and both local clients as one matching release between studies.

Recording storage limits are derived from `sessions.operatingLimits.maxConditionSeconds` for two mono 48 kHz S16LE tracks per participant, with allowance for shutdown and WAV headers. HTTP upload chunks are 1 MiB, uploads expire after ten minutes, and at most 100 unpaired participants can be admitted.

Only documented options are supported for server/session/media operation. Unknown keys fail startup rather than being silently ignored or treated as advanced overrides. Experiment conditions and pretest field definitions support the documented options below.

### Conditions config

The `conditions.baseline` runs as a first condition to establish a baseline for the participants. Afterwards, the server picks a random condition within `conditions.random` until all conditions are exhausted.

`conditions.baseline` must contain exactly one condition and `conditions.random` must be an array, which may also be empty. Condition properties (impairment parameters) not listed below are rejected. Numeric values may be JSON numbers or numeric strings and are normalized to numbers during startup.

You can use the following impairment parameters for the conditions:

- `nativeDelay`
- `nativeGain`
- `echoDelay`
- `echoGain`
- `packetlossType`
- `packetlossRatio`
- `packetlossSeed`
- `packetlossBurstModel`
- `packetlossBurstRatio`

If a parameter is omitted, est-core applies its default value; see the [est-core README](../est-core/README.md) for details.

### PretestForm config

The `pretestForm` array configures the fields shown by the GUI before the experiment starts. Each array entry describes one field in the rendered form. The server validates `pretestForm` during startup. If the form definition is invalid, the server refuses to start so configuration mistakes are caught before participants connect.

Use English source phrases for display-only labels, descriptions, placeholders, option labels, and slider marks. To translate new phrases, add them verbatim to the renderer's `est-gui/src/renderer/windowMain/assets/languages/{en,de}.csv` catalogs using the `source,translation` header: use the English phrase as `source` in both, the same phrase as its English translation, and the corresponding German text in `de.csv`. Quote cells containing commas, quotes, or line breaks and double embedded quotes. Rebuild and redeploy the matching clients and web assets. Text with no catalog entry is shown verbatim. Keep field names and option `value`s stable; they are used for validation and stored answers, not display.

**Supported pretest field types:**

| Type     | Function                                    | Saved value                                        |
| -------- | ------------------------------------------- | -------------------------------------------------- |
| `input`  | Renders a text or number input.             | String for text inputs, number for numeric inputs. |
| `select` | Renders a dropdown with configured entries. | The selected option's `value`.                     |
| `slider` | Renders a numeric slider.                   | Number.                                            |
| `switch` | Renders a boolean on/off switch.            | Boolean.                                           |

**Supported pretest field parameters:**

| Parameter      | Required | Description                                                                                                                                     |
| -------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | yes      | Unique string. This becomes the key in the resulting `client-*-pretest-form.json` file.                                                         |
| `type`         | yes      | Field renderer type: `input`, `select`, `slider`, or `switch`.                                                                                  |
| `label`        | yes      | Visible label shown to participants.                                                                                                            |
| `description`  | no       | Helper text shown below or next to the field.                                                                                                   |
| `placeholder`  | no       | Placeholder text for `input` and `select` fields.                                                                                               |
| `required`     | no       | Boolean. If omitted, `input` and `select` default to required, while `slider` and `switch` default to optional.                                 |
| `defaultValue` | no       | Initial value. The expected type depends on the field type.                                                                                     |
| `layoutWidth`  | no       | Integer from `1` to `12`. `12` is full width, `6` is half width, `4` is one third, and `3` is one quarter. If omitted, the field is full width. |
| `validation`   | no       | Field-specific legal-value rules.                                                                                                               |

**Field parameters for Inputs:**

| Parameter              | Description                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `inputType`            | `text` or `number`. If omitted, the GUI uses `text`.                                                                     |
| `validation.valueType` | `string`, `number`, or `integer`. If omitted, `number` inputs validate as numbers and `text` inputs validate as strings. |
| `validation.min`       | Minimum legal value for `number` or `integer` inputs.                                                                    |
| `validation.max`       | Maximum legal value for `number` or `integer` inputs.                                                                    |
| `validation.minLength` | Minimum length for `string` inputs.                                                                                      |
| `validation.maxLength` | Maximum length for `string` inputs.                                                                                      |
| `validation.pattern`   | Regular expression string for `string` inputs. The value must match this pattern.                                        |

**Field parameters for Selects:**

| Parameter      | Description                                                       |
| -------------- | ----------------------------------------------------------------- |
| `options`      | Required array of `{ "value": string, "label": string }` objects. |
| `defaultValue` | Optional string. Must match one configured option `value`.        |

For `select`, `label` is what participants see and `value` is what is saved. The configured option values are the only legal submitted values.

**Field parameters for Sliders:**

| Parameter         | Description                                                                            |
| ----------------- | -------------------------------------------------------------------------------------- |
| `validation.min`  | Lower numeric bound. Defaults to `0`.                                                  |
| `validation.max`  | Upper numeric bound. Defaults to `100`.                                                |
| `validation.step` | Slider increment. Defaults to `1`.                                                     |
| `defaultValue`    | Optional number. Must be inside the configured range and align with `validation.step`. |
| `marks.minLabel`  | Optional label shown below the lower end of the slider.                                |
| `marks.maxLabel`  | Optional label shown below the upper end of the slider.                                |

**Field parameters for Switches:**

| Parameter      | Description                                                                  |
| -------------- | ---------------------------------------------------------------------------- |
| `defaultValue` | Optional boolean. Usually `false`.                                           |
| `required`     | Usually unnecessary for switches. A switch is saved as a boolean either way. |

## Usage

`EST_SERVER_TYPE=server` runs the coordinator directly; `harness` supervises it with bounded restart delay, and `media-worker` is private child IPC entry, not a public service. Remote media workers execute the same SEA binary without requiring external Node. The core is selected automatically beside the packaged server (`core/est-core` on Linux, `core/est-core.exe` on Windows), independently of the caller's working directory. Source execution uses the managed platform-specific `est-core/build` output.

### Local and remote controls

| Section | Operational policy |
| --- | --- |
| `server` | Listen address/port, `mode: local|remote`, `maxActivePairs` (default 1). One coordinator per results directory. |
| `remote` | Public ICE range and ICE/TURN services. Keep public ICE ports separate from private RTP ports. |
| `prolific` | Study ID, all four completion codes, optional secured URLs; answers plus matching durable WAV receipts gate normal completion. |
| `sessions` | Required study language (`en` or `de`), FIFO after setup/pretest, waiting/reconnect/retry policy, condition duration and audio setup. Defaults: 5-minute wait, 60-second grace, one retry, 600-second condition limit. Setup is optional locally and mandatory remotely. |

Browser entry: `https://study.example.org/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`. Raw identifiers are recorded as unverified, never used as paths or A/B role selectors. Set `secureUrls`, exact `externalStudyUrl`, `workspaceId` and optional `organisationId` for Prolific's RS256 `prolific_token` verification against its fixed JWKS endpoint. The token lifetime/issuer/audience/query/subject/identifier claims are checked. Manage participant payments and rejections in Prolific. The researcher configures completed/technicalFailure/partnerLeft/waitingTimeout codes and their meaning in Prolific. A successful return link and copyable code come only from server-owned outcome state.

Set `remote.turnSecret` in the private server config to the shared secret configured in coturn. Authenticated per-attempt preparation uses it to issue expiring HMAC TURN credentials scoped to the session. `turnUrls` should include reachable UDP, TCP and TLS endpoints. HTTPS is not a media relay. See [deployment networking](../deployment/README.md#networking).

Before joining the ready queue, remote admissions expire after `sessions.operatingLimits.pairingTimeoutSeconds` without a successful setup/questionnaire/navigation action (default five minutes). Progress renews this inactivity window; once queued, the original FIFO waiting deadline is not extended by repeated actions. Expiration persists `waitingTimeout`, releases admission capacity, and never permits normal completion or duplicate Prolific reenrollment.

For another local laboratory run, finish/end the current session, then close and relaunch both Electron clients. Each launch uses its saved credentials to resume an unfinished session or obtain a new participant enrollment after a terminal one. The machine labels remain `client-a`/`client-b`; old session directories, tokens and outcomes remain intact. Do not delete enrollment/results files between runs. Remote Prolific submissions remain terminal and cannot use this local renewal path.

#### Interrupted sessions and recording collection

If a remote participant disconnects during a conversation, the coordinator stops the condition and marks the attempt incomplete. If the pair recovers within `reconnectGraceSeconds` and has a retry left under `maxRetries`, the same two participants restart the condition from the beginning. Otherwise the session ends early; neither participant is replaced.

Clients upload recordings after each condition and keep their copies until they receive a [matching storage receipt](#application-protocol). Remote participants should keep the [browser tab](../est-gui/README.md#browser-deployment) open: closing or reloading it can lose audio still in memory.

A coordinator restart ends an active conversation with `technicalFailure`. If the conversation had already stopped and only uploads were pending, clients can still finish them before the original upload deadline when the study configuration is unchanged. The coordinator uses saved credentials, recording manifests and receipts to check what remains to be collected.

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

## Application protocol

Electron and browser clients use the version-1 Socket.IO contract defined in [`common/protocol.cjs`](../common/protocol.cjs). The `@effectstreamer/common` entry is browser-safe; native core supervision uses the separate `@effectstreamer/common/core-process` entry.

Actions carry request, participant, session and attempt identifiers, but identifiers are not authentication. The server authenticates membership, validates the current state and publishes snapshots with increasing `revision`. Clients retain recordings until a matching `{recordingId, sha256, stored: true}` receipt confirms storage.

## Compilation

The build bundles the coordinator and worker entry with `ncc` and injects a SEA blob with `postject`. Bundler/SEA inputs and caches use `/tmp/effectstreamer/<user>/<checkout>/est-server` on Linux; the executable and core/runtime are assembled directly in the new final distribution. Existing destinations are never overwritten, but failure may leave partial output. Required inputs: matching `SDK`, `EST_NETSIM_PLUGIN` and a source-built core. From the repository root, query the default Linux core path with `bash common/transient-paths.sh path est-core build linux est-core`. Set `EST_DISTRIBUTION_DIR` for another new final output. See [deployment/README.md](../deployment/README.md); old tracked core/runtime archives are not source-build evidence.

### Linux

To create the Linux executable:

```
npm install
npm run build:linux
```

The Linux distribution is written to `est-server/dist/linux`. Transfer the whole directory, not just the executable. Both local-use and remote-use example configurations are included. Copy the selected example to `~/effectstreamer/est-server.config.json`.

### Windows

To create the Windows executable:

```
npm install
npm run build:win
```

The Windows distribution is written to `est-server/dist/win` with `est-server.exe`, `core/est-core.exe`, matching DLLs and both local-use/remote-use example configurations. Copy the selected example to `%USERPROFILE%\effectstreamer\est-server.config.json`. Use the matching Node target version and run the installer/package smoke checks on Windows before release.
