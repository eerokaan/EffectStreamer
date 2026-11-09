# EffectStreamer Server

## Introduction

This is the EffectStreamer Server – it orchestrates the entire experiment; managing state, coordinating all connected participants, collecting evaluation data, and serving as the single source of truth via a central configuration file.

The server writes to `~/effectstreamer/sessions` (override with `EST_RESULTS_ROOT`). Each pair has a UUID directory with `session.json`, condition settings/forms/ratings, and recording attempts under `attempts/<attemptId>/<participantId>/{microphone,headphones}.wav`. `enrollments.json` stores stable identities and hashed reconnect credentials; chunk/receipt bookkeeping allows retries. No audio transport/timing-analysis sidecars are written.

All application files are saved directly, without atomic replacement files. Upload chunks go directly to the final WAV path; a partial or invalid WAV can exist there before completion. Format/size/checksum validation and persisted storage receipts—not filename existence—gate completion and client cleanup. Existing `.uploads/<id>.part` recordings are copied/reconciled into their final paths with prefix-conflict checks and retained until validation, receipt persistence and session reconciliation succeed. No new `.part` files are created. Interrupted JSON/WAV writes can leave corrupt/incomplete data; keep study data on persistent storage, back it up, and do not interpret successful ordinary restarts as power-loss-safe saving.

EffectStreamer Server is distributed as a standalone Node.js executable and should be started before the GUI clients connect.

## The configuration file

Before starting the server, copy the `config-server.example.json` config file to `~/effectstreamer/config-server.json` and adjust it for your needs. The path is based on the current OS user's home directory on Linux and Windows.

Set `EST_CONFIG_PATH` to select another mounted JSON file. `config-server.remote.example.json` is the remote starting point; replace study IDs/codes/DNS and provide a private TURN secret before deployment. For remote same-origin hosting, `EST_WEB_ROOT` overrides the adjacent packaged `web` directory (development default: managed `est-gui/web` under `/tmp/effectstreamer`). A missing web build prevents startup; rebuild it after transient cleanup.

On Linux for example, the initial setup can be performed with:

```
mkdir -p ~/effectstreamer
cp config-server.example.json ~/effectstreamer/config-server.json
```

An example configuration looks like this:

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
    },
    "pretestForm": [
        {
            "name": "input-age",
            "type": "input",
            "inputType": "number",
            "label": "Alter",
            "description": "Wie alt sind Sie?",
            "placeholder": "Bitte angeben",
            "required": true,
            "layoutWidth": 6,
            "validation": { "valueType": "integer", "min": 0 }
        },
        {
            "name": "select-gender",
            "type": "select",
            "label": "Gender",
            "placeholder": "Bitte angeben",
            "required": true,
            "layoutWidth": 6,
            "options": [
                { "value": "female", "label": "Weiblich" },
                { "value": "male", "label": "Männlich" },
                { "value": "no-choice", "label": "Keine Angabe" }
            ]
        },
        {
            "name": "slider-experience",
            "type": "slider",
            "label": "Bisherige Erfahrung mit Sprach/Videotelefonie",
            "required": false,
            "layoutWidth": 12,
            "validation": { "min": 0, "max": 100, "step": 1 },
            "defaultValue": 50,
            "marks": { "minLabel": "Nicht erfahren", "maxLabel": "Sehr erfahren" }
        },
        {
            "name": "switch-prior-experience",
            "type": "switch",
            "label": "Schon Erfahrung gesammelt?",
            "description": "Haben Sie schon einmal an einem Hörtest/-experiment teilgenommen?",
            "required": false,
            "layoutWidth": 6,
            "defaultValue": false
        }
    ]
}
```

### Server config

The `server` values define where the server listens for `est-gui` clients. `ipAddress` must be an IPv4 or IPv6 address and `port` must be an integer from `1` through `65535`. Ports supplied as numeric strings are normalized to numbers.

### Tests config

The `tests` values define which test types are included in the experiment flow. Both values are required booleans; set `short-conversation-test` or `listening-speaking-test` to `false` to skip that test type for every condition.

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

`EST_SERVER_TYPE=server` runs the coordinator directly; `harness` supervises it with bounded restart delay, and `media-worker` is private child IPC entry, not a public service. Remote media workers execute the same SEA binary without requiring external Node. Relative `remote.coreExecutable` resolves beside the server executable in a distribution, not relative to the caller's working directory. On Windows select `core/est-core.exe`.

### Local and remote controls

| Section | Operational policy |
| --- | --- |
| `deployment` | `mode: local|remote`, explicit `maxActivePairs` (default 1), development admission opt-in only. One coordinator, no distributed matchmaking. |
| `audioSetup` | Local optional, remote mandatory; default route selections and P.501 input/playback/confirmation gates. |
| `sessions` | FIFO after setup/pretest, 5-minute waiting timeout, 60-second reconnect grace, one retry, 100 unpaired admissions by default. |
| `recordings` | Default maximum 600 seconds/134217728 bytes per participant, 1 MiB HTTP chunks, 10-minute upload deadline. Bounds must hold both WAVs. |
| `remote` | Core path, disjoint private/public port ranges, 128-frame internal RTP, Opus 128000 bit/s, 20 ms WebRTC jitter target, 250 ms bounded playback drain, 30-second startup/7-second stop deadlines. These are not end-to-end delay guarantees. |
| `prolific` | Study ID, all four completion codes, optional secured URLs; answers plus matching durable WAV receipts gate normal completion. |

Browser entry: `https://study.example.org/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`. Raw identifiers are recorded as unverified, never used as paths or A/B role selectors. Set `secureUrls`, exact `externalStudyUrl`, `workspaceId` and optional `organisationId` for Prolific's RS256 `prolific_token` verification against its fixed JWKS endpoint. The token lifetime/issuer/audience/query/subject/identifier claims are checked. No Prolific API payment or rejection calls are made. The researcher configures completed/technicalFailure/partnerLeft/waitingTimeout codes and their meaning in Prolific. A successful return link and copyable code come only from server-owned outcome state.

Use `EST_TURN_SECRET` for an environment-secret override, shared with coturn; the secret never appears in public bootstrap. Authenticated per-attempt preparation issues expiring HMAC TURN credentials scoped to the session. `turnUrls` should include reachable UDP, TCP and TLS endpoints. HTTPS is not a media relay. See [deployment networking](../deployment/README.md).

Before joining the ready queue, remote admissions expire after `sessions.pairingTimeoutMs` without a successful setup/questionnaire/navigation action (default five minutes). Progress renews this inactivity window; once queued, the original FIFO waiting deadline is not extended by repeated actions. Expiration persists `waitingTimeout`, releases admission capacity, and never permits normal completion or duplicate Prolific reenrollment.

For another local laboratory run, finish/end the current session, then close and relaunch both Electron clients. Each launch uses its saved credentials to resume an unfinished session or obtain a new participant enrollment after a terminal one. The machine labels remain `client-a`/`client-b`; old session directories, tokens and outcomes remain intact. Do not delete enrollment/results files between runs. Remote Prolific submissions remain terminal and cannot use this local renewal path.

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

The build bundles the coordinator and worker entry with `ncc` and injects a SEA blob with `postject`. Bundler/SEA inputs and caches use `/tmp/effectstreamer/<user>/<checkout>/est-server`; the executable, core/runtime and web resources are assembled directly in the new final distribution. Existing destinations are never overwritten, but failure may leave partial output. Required inputs: matching `SDK`, `EST_NETSIM_PLUGIN`, a source-built core and managed web build. Defaults are queried with `bash est-common/transient-paths.sh path est-core build linux est-core` and `... path est-gui web` from the repository root. Set `EST_DISTRIBUTION_DIR` for another new final output. Runtime caches are also disposable; `EST_RESULTS_ROOT` is not. See [deployment/README.md](../deployment/README.md); old tracked core/runtime archives are not source-build evidence.

### Linux

To create the Linux executable:

```
npm install
npm run build:linux
```

The Linux distribution is written to `est-server/dist/linux`. Transfer the whole directory, not just the executable. The default configuration path remains `~/effectstreamer/config-server.json`, overridable with `EST_CONFIG_PATH`.

### Windows

To create the Windows executable:

```
npm install
npm run build:win
```

The Windows distribution is written to `est-server/dist/win` with `est-server.exe`, `core/est-core.exe`, matching DLLs and `web/`. Cross-building it is not a Windows runtime/device acceptance result. Use the matching Node target version and run the installer/package smoke checks on Windows before release.
