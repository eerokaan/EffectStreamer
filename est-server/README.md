# EffectStreamer Server

## Introduction

This is the EffectStreamer Server – it orchestrates the entire experiment; managing state, coordinating all connected participants, collecting evaluation data, and serving as the single source of truth via a central configuration file.

The server writes session data to `~/effectstreamer`. Each experiment run receives a new `session_####` directory containing submitted forms, scale results, condition settings, and transferred audio recordings inside `condition_####` subdirectories.

EffectStreamer Server is distributed as a standalone Node.js executable and should be started before the GUI clients connect.

## The configuration file

Before starting the server, place an `est-config.json` file next to the server executable and adjust it for your needs. This how this file may look like:

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

The `server` values define where the server listens for `est-gui` clients.

### Tests config

The `tests` values define which test types are included in the experiment flow; set `short-conversation-test` or `listening-speaking-test` to `false` to skip that test type for every condition.

### Conditions config

The `conditions.baseline` runs as a first condition to establish a baseline for the participants. Afterwards, the server picks a random condition within `conditions.random` until all conditions are exhausted.

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

**Input field parameters:**

| Parameter              | Description                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `inputType`            | `text` or `number`. If omitted, the GUI uses `text`.                                                                     |
| `validation.valueType` | `string`, `number`, or `integer`. If omitted, `number` inputs validate as numbers and `text` inputs validate as strings. |
| `validation.min`       | Minimum legal value for `number` or `integer` inputs.                                                                    |
| `validation.max`       | Maximum legal value for `number` or `integer` inputs.                                                                    |
| `validation.minLength` | Minimum length for `string` inputs.                                                                                      |
| `validation.maxLength` | Maximum length for `string` inputs.                                                                                      |
| `validation.pattern`   | Regular expression string for `string` inputs. The value must match this pattern.                                        |

**Select field parameters:**

| Parameter      | Description                                                       |
| -------------- | ----------------------------------------------------------------- |
| `options`      | Required array of `{ "value": string, "label": string }` objects. |
| `defaultValue` | Optional string. Must match one configured option `value`.        |

For `select`, `label` is what participants see and `value` is what is saved. The configured option values are the only legal submitted values.

**Slider field parameters:**

| Parameter         | Description                                                                            |
| ----------------- | -------------------------------------------------------------------------------------- |
| `validation.min`  | Lower numeric bound. Defaults to `0`.                                                  |
| `validation.max`  | Upper numeric bound. Defaults to `100`.                                                |
| `validation.step` | Slider increment. Defaults to `1`.                                                     |
| `defaultValue`    | Optional number. Must be inside the configured range and align with `validation.step`. |
| `marks.minLabel`  | Optional label shown below the lower end of the slider.                                |
| `marks.maxLabel`  | Optional label shown below the upper end of the slider.                                |

**Switch field parameters:**

| Parameter      | Description                                                                  |
| -------------- | ---------------------------------------------------------------------------- |
| `defaultValue` | Optional boolean. Usually `false`.                                           |
| `required`     | Usually unnecessary for switches. A switch is saved as a boolean either way. |

## Usage

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

### Linux

To create the Linux executable:

```
npm install
npm run build:linux
```

The Linux executable and a copy of `est-config.json` will be written to `est-server/dist`.

### Windows

To create the Windows executable:

```
npm install
npm run build:win
```

The Windows executable and a copy of `est-config.json` will be written to `est-server/dist`.
