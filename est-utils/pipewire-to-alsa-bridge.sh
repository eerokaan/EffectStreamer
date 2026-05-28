#!/bin/bash

# EffectStreamer Utilities: PipeWire-to-ALSA Bridge
# @company Quality and Usability Lab | TU Berlin
# @author  Eero Kaan <eerokaan@qu.tu-berlin.de>

set -Eeuo pipefail

CONFIG_PATH="${EST_GUI_CONFIG:-${PWD}/est-config.json}"

EST_SOURCE_DEVICE="plughw:Loopback,1,1"
EST_SINK_DEVICE="plughw:Loopback,0,0"
SOURCE_BRIDGE_PLAYBACK="hw:Loopback,0,1"
SINK_BRIDGE_CAPTURE="hw:Loopback,1,0"

WPCTL_STATUS_OUTPUT=""
SENDER_LOOP_PID=""
RECEIVER_LOOP_PID=""
BRIDGE_LOG_DIR=""
ORIGINAL_SOURCE_DEFAULT_ID=""
ORIGINAL_SINK_DEFAULT_ID=""
SOURCE_DEFAULT_CHANGED="0"
SINK_DEFAULT_CHANGED="0"
CONFIG_UPDATED="0"
CONFIG_RESTORE_METHOD=""
CONFIG_RESTORE_PATH=""
ORIGINAL_CONFIG_SOURCE_PRESENT="0"
ORIGINAL_CONFIG_SINK_PRESENT="0"
ORIGINAL_CONFIG_SOURCE_JSON="null"
ORIGINAL_CONFIG_SINK_JSON="null"
ORIGINAL_CONFIG_SOURCE_LINE=""
ORIGINAL_CONFIG_SINK_LINE=""

SOURCE_IDS=()
SOURCE_NAMES=()
SOURCE_DEFAULTS=()
SOURCE_KINDS=()
SOURCE_APIS=()
SOURCE_BACKENDS=()

SINK_IDS=()
SINK_NAMES=()
SINK_DEFAULTS=()
SINK_KINDS=()
SINK_APIS=()
SINK_BACKENDS=()

SELECTED_SOURCE_ID=""
SELECTED_SOURCE_NAME=""
SELECTED_SOURCE_KIND=""
SELECTED_SOURCE_API=""
SELECTED_SOURCE_BACKEND=""

SELECTED_SINK_ID=""
SELECTED_SINK_NAME=""
SELECTED_SINK_KIND=""
SELECTED_SINK_API=""
SELECTED_SINK_BACKEND=""

die() {
    printf 'Error: %s\n' "$*" >&2
    exit 1
}

trim() {
    local value="${1:-}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf '%s' "$value"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

process_alive() {
    local pid="${1:-}"
    [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

stop_process() {
    local pid="${1:-}"
    local attempt

    if process_alive "$pid"; then
        kill "$pid" >/dev/null 2>&1 || true

        for attempt in 1 2 3 4 5 6 7 8 9 10; do
            if ! process_alive "$pid"; then
                break
            fi
            sleep 0.2
        done

        if process_alive "$pid"; then
            kill -KILL "$pid" >/dev/null 2>&1 || true
        fi

        wait "$pid" >/dev/null 2>&1 || true
    fi
}

restore_pipewire_defaults() {
    if [[ "$SOURCE_DEFAULT_CHANGED" == "1" && -n "$ORIGINAL_SOURCE_DEFAULT_ID" ]]; then
        wpctl set-default "$ORIGINAL_SOURCE_DEFAULT_ID" >/dev/null 2>&1 || true
    fi

    if [[ "$SINK_DEFAULT_CHANGED" == "1" && -n "$ORIGINAL_SINK_DEFAULT_ID" ]]; then
        wpctl set-default "$ORIGINAL_SINK_DEFAULT_ID" >/dev/null 2>&1 || true
    fi
}

cleanup() {
    trap - EXIT INT TERM

    stop_process "$SENDER_LOOP_PID"
    stop_process "$RECEIVER_LOOP_PID"
    restore_est_config
    restore_pipewire_defaults
}

handle_signal() {
    printf '\n'
    printf 'Shutting down audio bridge...\n'
    exit 130
}

trap cleanup EXIT
trap handle_signal INT TERM

assert_non_root() {
    if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
        die 'Run this script as a normal user. It will ask sudo only for operations that need root permissions.'
    fi
}

require_commands() {
    local missing=0
    local cmd

    for cmd in sudo modprobe wpctl gst-launch-1.0 mktemp mv rm; do
        if ! command_exists "$cmd"; then
            printf 'Missing required command: %s\n' "$cmd" >&2
            missing=1
        fi
    done

    if [[ "$missing" -ne 0 ]]; then
        die 'Install the missing commands and run this helper again.'
    fi
}

prompt_device_connected() {
    printf '\n'
    printf 'PipeWire to ALSA bridge setup\n'
    printf 'Connect the intended audio source and sink devices to this computer now.\n'
    printf 'Press any key to continue...'
    IFS= read -r -n 1 _
    printf '\n'
}

gui_file_picker_available() {
    [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] || return 1
    command_exists zenity || command_exists kdialog || command_exists yad
}

pick_config_path_with_gui() {
    local default_path="$1"

    if command_exists zenity; then
        zenity --file-selection --title='Select est-config.json' --filename="$default_path" 2>/dev/null
        return $?
    fi

    if command_exists kdialog; then
        kdialog --getopenfilename "$default_path" 'JSON files (*.json)' 2>/dev/null
        return $?
    fi

    if command_exists yad; then
        yad --file-selection --title='Select est-config.json' --filename="$default_path" 2>/dev/null
        return $?
    fi

    return 1
}

read_config_path_from_terminal() {
    local default_path="$1"
    local selected_path=""

    printf 'est-config.json path: ' >&2
    if [[ -t 0 && "${BASH_VERSINFO[0]}" -ge 4 ]]; then
        IFS= read -r -e -i "$default_path" selected_path || selected_path=""
    else
        printf '[%s] ' "$default_path" >&2
        IFS= read -r selected_path || selected_path=""
    fi

    printf '%s' "${selected_path:-$default_path}"
}

prompt_config_path() {
    local default_path="${EST_GUI_CONFIG:-${PWD}/est-config.json}"
    local answer
    local selected_path

    printf '\n'
    printf 'Select the est-config.json file to update.\n'
    printf 'Default: %s\n' "$default_path"

    while true; do
        selected_path=""

        if gui_file_picker_available; then
            printf 'Open a file picker? [y/N]: '
            IFS= read -r answer || answer=""

            case "$answer" in
                y|Y|yes|YES|Yes)
                    selected_path="$(pick_config_path_with_gui "$default_path" || true)"
                    ;;
                ''|n|N|no|NO|No)
                    selected_path="$(read_config_path_from_terminal "$default_path")"
                    ;;
                *)
                    printf 'Please answer yes or no.\n'
                    continue
                    ;;
            esac
        else
            selected_path="$(read_config_path_from_terminal "$default_path")"
        fi

        selected_path="$(trim "$selected_path")"
        selected_path="${selected_path/#\~/$HOME}"

        if [[ -f "$selected_path" ]]; then
            CONFIG_PATH="$selected_path"
            printf 'Using est-gui config: %s\n' "$CONFIG_PATH"
            return 0
        fi

        printf 'Config file not found: %s\n' "$selected_path"
    done
}

load_loopback_module() {
    local output

    printf 'Loading ALSA loopback module...\n'
    if ! output="$(sudo modprobe snd-aloop 2>&1)"; then
        [[ -n "$output" ]] && printf '%s\n' "$output" >&2
        die 'Failed to load snd-aloop.'
    fi

    if [[ -n "$output" ]]; then
        printf '%s\n' "$output"
    else
        printf 'snd-aloop is ready.\n'
    fi
}

create_temp_path_for() {
    mktemp "${1}.XXXXXX"
}

create_temp_config_path() {
    create_temp_path_for "$CONFIG_PATH"
}

create_bridge_log_dir() {
    mktemp -d "${TMPDIR:-/tmp}/est-audio-bridge.XXXXXX"
}

capture_est_config_restore_state_with_jq() {
    ORIGINAL_CONFIG_SOURCE_PRESENT="$(jq -r 'if ((.client.audioDevices? | type) == "object") then (if (.client.audioDevices | has("source")) then "1" else "0" end) else "0" end' "$CONFIG_PATH")"
    ORIGINAL_CONFIG_SINK_PRESENT="$(jq -r 'if ((.client.audioDevices? | type) == "object") then (if (.client.audioDevices | has("sink")) then "1" else "0" end) else "0" end' "$CONFIG_PATH")"
    ORIGINAL_CONFIG_SOURCE_JSON="$(jq -c 'if ((.client.audioDevices? | type) == "object" and (.client.audioDevices | has("source"))) then .client.audioDevices.source else null end' "$CONFIG_PATH")"
    ORIGINAL_CONFIG_SINK_JSON="$(jq -c 'if ((.client.audioDevices? | type) == "object" and (.client.audioDevices | has("sink"))) then .client.audioDevices.sink else null end' "$CONFIG_PATH")"
}

restore_est_config_with_jq() {
    local tmp_path

    if ! command_exists jq; then
        printf 'Could not restore est-gui config values: jq is no longer available.\n' >&2
        return 0
    fi

    if [[ ! -f "$CONFIG_RESTORE_PATH" ]]; then
        printf 'Could not restore est-gui config values: config file not found: %s\n' "$CONFIG_RESTORE_PATH" >&2
        return 0
    fi

    if ! tmp_path="$(create_temp_path_for "$CONFIG_RESTORE_PATH" 2>/dev/null)"; then
        printf 'Could not restore est-gui config values: failed to create temporary file.\n' >&2
        return 0
    fi

    if jq --arg source_present "$ORIGINAL_CONFIG_SOURCE_PRESENT" \
        --arg sink_present "$ORIGINAL_CONFIG_SINK_PRESENT" \
        --argjson source "$ORIGINAL_CONFIG_SOURCE_JSON" \
        --argjson sink "$ORIGINAL_CONFIG_SINK_JSON" \
        'if $source_present == "1" then .client.audioDevices.source = $source else del(.client.audioDevices.source) end | if $sink_present == "1" then .client.audioDevices.sink = $sink else del(.client.audioDevices.sink) end' \
        "$CONFIG_RESTORE_PATH" > "$tmp_path" && mv "$tmp_path" "$CONFIG_RESTORE_PATH"; then
        printf 'Restored est-gui config values: %s\n' "$CONFIG_RESTORE_PATH"
    else
        rm -f "$tmp_path"
        printf 'Could not restore est-gui config values. Check the config file manually: %s\n' "$CONFIG_RESTORE_PATH" >&2
    fi

    return 0
}

restore_est_config_with_saved_lines() {
    local tmp_path
    local line
    local in_client=0
    local in_audio_devices=0
    local brace_depth=0
    local source_restored=0
    local sink_restored=0

    if [[ ! -f "$CONFIG_RESTORE_PATH" ]]; then
        printf 'Could not restore est-gui config values: config file not found: %s\n' "$CONFIG_RESTORE_PATH" >&2
        return 0
    fi

    if [[ -z "$ORIGINAL_CONFIG_SOURCE_LINE" || -z "$ORIGINAL_CONFIG_SINK_LINE" ]]; then
        printf 'Could not restore est-gui config values: original config lines were not captured.\n' >&2
        return 0
    fi

    if ! tmp_path="$(create_temp_path_for "$CONFIG_RESTORE_PATH" 2>/dev/null)"; then
        printf 'Could not restore est-gui config values: failed to create temporary file.\n' >&2
        return 0
    fi

    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" =~ ^([[:space:]]*)\"client\"[[:space:]]*:[[:space:]]*\{ ]]; then
            in_client=1
            brace_depth=1
        elif [[ "$in_client" == "1" ]]; then
            if [[ "$line" == *"{"* ]]; then
                brace_depth="$((brace_depth + 1))"
            fi

            if [[ "$line" =~ ^[[:space:]]*\"audioDevices\"[[:space:]]*:[[:space:]]*\{ ]]; then
                in_audio_devices=1
            elif [[ "$in_audio_devices" == "1" && "$line" =~ ^[[:space:]]*\"source\"[[:space:]]*: ]]; then
                printf '%s\n' "$ORIGINAL_CONFIG_SOURCE_LINE" >> "$tmp_path"
                source_restored=1
                continue
            elif [[ "$in_audio_devices" == "1" && "$line" =~ ^[[:space:]]*\"sink\"[[:space:]]*: ]]; then
                printf '%s\n' "$ORIGINAL_CONFIG_SINK_LINE" >> "$tmp_path"
                sink_restored=1
                continue
            fi
        fi

        printf '%s\n' "$line" >> "$tmp_path"

        if [[ "$in_client" == "1" && "$line" == *"}"* ]]; then
            brace_depth="$((brace_depth - 1))"
            if [[ "$in_audio_devices" == "1" && "$brace_depth" -le 1 ]]; then
                in_audio_devices=0
            fi
            if [[ "$brace_depth" -le 0 ]]; then
                in_client=0
            fi
        fi
    done < "$CONFIG_RESTORE_PATH"

    if [[ "$source_restored" == "1" && "$sink_restored" == "1" ]] && mv "$tmp_path" "$CONFIG_RESTORE_PATH"; then
        printf 'Restored est-gui config values: %s\n' "$CONFIG_RESTORE_PATH"
    else
        rm -f "$tmp_path"
        printf 'Could not restore est-gui config values. Check the config file manually: %s\n' "$CONFIG_RESTORE_PATH" >&2
    fi

    return 0
}

restore_est_config() {
    if [[ "$CONFIG_UPDATED" != "1" || -z "$CONFIG_RESTORE_PATH" ]]; then
        return 0
    fi

    case "$CONFIG_RESTORE_METHOD" in
        jq)
            restore_est_config_with_jq
            ;;
        lines)
            restore_est_config_with_saved_lines
            ;;
        *)
            printf 'Could not restore est-gui config values: unknown restore method.\n' >&2
            ;;
    esac

    CONFIG_UPDATED="0"
    return 0
}

extract_inspect_property() {
    local inspect_text="$1"
    local property="$2"
    local line
    local line_trimmed
    local value

    while IFS= read -r line; do
        line_trimmed="$(trim "$line")"
        if [[ "$line_trimmed" == "$property = "* || "$line_trimmed" == "$property="* ]]; then
            value="${line_trimmed#*=}"
            value="$(trim "$value")"

            if [[ "$value" == \"* ]]; then
                value="${value#\"}"
                value="${value%%\"*}"
            else
                value="${value%% *}"
            fi

            printf '%s' "$value"
            return 0
        fi
    done <<< "$inspect_text"

    return 1
}

first_inspect_property() {
    local inspect_text="$1"
    shift

    local property
    local value

    for property in "$@"; do
        value="$(extract_inspect_property "$inspect_text" "$property" || true)"
        if [[ -n "$value" ]]; then
            printf '%s' "$value"
            return 0
        fi
    done

    return 1
}

derive_alsa_backend() {
    local inspect_text="$1"
    local card
    local device
    local value
    local property

    card="$(first_inspect_property "$inspect_text" api.alsa.pcm.card api.alsa.card alsa.card || true)"
    device="$(first_inspect_property "$inspect_text" api.alsa.pcm.device api.alsa.device alsa.device || true)"

    if [[ -z "$card" || -z "$device" ]]; then
        for property in api.alsa.path device.string node.name object.path; do
            value="$(extract_inspect_property "$inspect_text" "$property" || true)"
            if [[ "$value" =~ hw:([0-9]+),([0-9]+) ]]; then
                card="${BASH_REMATCH[1]}"
                device="${BASH_REMATCH[2]}"
                break
            fi
            if [[ "$value" =~ hw:([0-9]+)$ ]]; then
                card="${BASH_REMATCH[1]}"
                device="0"
                break
            fi
        done
    fi

    if [[ "$card" =~ ^[0-9]+$ && "$device" =~ ^[0-9]+$ ]]; then
        printf 'plughw:%s,%s' "$card" "$device"
        return 0
    fi

    return 1
}

is_loopback_node() {
    local display_name="$1"
    local node_name="$2"

    case "$display_name" in
        *Loopback*|*loopback*) return 0 ;;
    esac

    case "$node_name" in
        *Loopback*|*loopback*|*snd_aloop*) return 0 ;;
    esac

    return 1
}

append_device() {
    local device_type="$1"
    local id="$2"
    local is_default="$3"
    local display_name="$4"
    local inspect_text
    local api
    local node_name
    local kind
    local backend

    inspect_text="$(wpctl inspect "$id" 2>/dev/null || true)"
    api="$(extract_inspect_property "$inspect_text" device.api || true)"
    node_name="$(extract_inspect_property "$inspect_text" node.name || true)"

    if [[ -z "$api" ]]; then
        case "$node_name" in
            alsa_*) api="alsa" ;;
            bluez_*|bluez5*) api="bluez5" ;;
            *) api="pipewire" ;;
        esac
    fi

    if is_loopback_node "$display_name" "$node_name"; then
        return 0
    fi

    if [[ "$api" == "alsa" ]]; then
        kind="ALSA"
        backend="$(derive_alsa_backend "$inspect_text" || true)"
    else
        kind="PipeWire"
        backend="pipewire"
    fi

    if [[ "$device_type" == "source" ]]; then
        SOURCE_IDS+=("$id")
        SOURCE_NAMES+=("$display_name")
        SOURCE_DEFAULTS+=("$is_default")
        SOURCE_KINDS+=("$kind")
        SOURCE_APIS+=("$api")
        SOURCE_BACKENDS+=("$backend")
    else
        SINK_IDS+=("$id")
        SINK_NAMES+=("$display_name")
        SINK_DEFAULTS+=("$is_default")
        SINK_KINDS+=("$kind")
        SINK_APIS+=("$api")
        SINK_BACKENDS+=("$backend")
    fi
}

parse_wpctl_status() {
    local line
    local trimmed_line
    local in_audio=0
    local section=""
    local id
    local name
    local default_marker

    if ! WPCTL_STATUS_OUTPUT="$(wpctl status 2>&1)"; then
        printf '%s\n' "$WPCTL_STATUS_OUTPUT" >&2
        die 'wpctl status failed. Is PipeWire/WirePlumber running?'
    fi

    while IFS= read -r line; do
        trimmed_line="$(trim "$line")"

        case "$trimmed_line" in
            Audio)
                in_audio=1
                section=""
                continue
                ;;
            Video|Settings)
                in_audio=0
                section=""
                continue
                ;;
        esac

        if [[ "$in_audio" -ne 1 ]]; then
            continue
        fi

        case "$line" in
            *"Sinks:"*)
                section="sink"
                continue
                ;;
            *"Sources:"*)
                section="source"
                continue
                ;;
            *"Devices:"*|*"Sink endpoints:"*|*"Source endpoints:"*|*"Streams:"*)
                section=""
                continue
                ;;
        esac

        if [[ "$section" != "source" && "$section" != "sink" ]]; then
            continue
        fi

        if [[ "$line" =~ ([0-9]+)\.[[:space:]]+(.+) ]]; then
            id="${BASH_REMATCH[1]}"
            name="${BASH_REMATCH[2]}"
            default_marker="0"

            if [[ "$line" =~ \*[[:space:]]*[0-9]+\. ]]; then
                default_marker="1"
            fi

            if [[ "$default_marker" == "1" ]]; then
                if [[ "$section" == "source" ]]; then
                    ORIGINAL_SOURCE_DEFAULT_ID="$id"
                else
                    ORIGINAL_SINK_DEFAULT_ID="$id"
                fi
            fi

            if [[ "$name" == *" ["* ]]; then
                name="${name% \[*}"
            fi

            name="$(trim "$name")"
            append_device "$section" "$id" "$default_marker" "$name"
        fi
    done <<< "$WPCTL_STATUS_OUTPUT"

    if [[ "${#SOURCE_IDS[@]}" -eq 0 ]]; then
        die 'No usable audio sources found in wpctl status.'
    fi

    if [[ "${#SINK_IDS[@]}" -eq 0 ]]; then
        die 'No usable audio sinks found in wpctl status.'
    fi
}

print_device_entry() {
    local index="$1"
    local id="$2"
    local name="$3"
    local is_default="$4"
    local kind="$5"
    local api="$6"
    local backend="$7"
    local default_label=""
    local backend_label
    local type_label

    if [[ "$is_default" == "1" ]]; then
        default_label=" default"
    fi

    if [[ "$kind" == "ALSA" ]]; then
        type_label="ALSA"
        if [[ -n "$backend" ]]; then
            backend_label="$backend"
        else
            backend_label="no plughw id found"
        fi
    else
        type_label="PipeWire/${api}"
        backend_label="pipewire PCM after wpctl set-default ${id}"
    fi

    printf '  %2d) [%s] %s%s\n' "$index" "$type_label" "$name" "$default_label"
    printf '      backend: %s\n' "$backend_label"
}

select_source_device() {
    local choice
    local count="${#SOURCE_IDS[@]}"
    local index

    printf '\n'
    printf 'Audio source devices\n'

    while true; do
        for index in "${!SOURCE_IDS[@]}"; do
            print_device_entry "$((index + 1))" "${SOURCE_IDS[$index]}" "${SOURCE_NAMES[$index]}" "${SOURCE_DEFAULTS[$index]}" "${SOURCE_KINDS[$index]}" "${SOURCE_APIS[$index]}" "${SOURCE_BACKENDS[$index]}"
        done

        printf 'Select source device [1-%d]: ' "$count"
        IFS= read -r choice

        if [[ "$choice" =~ ^[0-9]+$ && "$choice" -ge 1 && "$choice" -le "$count" ]]; then
            index="$((choice - 1))"
            if [[ "${SOURCE_KINDS[$index]}" == "ALSA" && -z "${SOURCE_BACKENDS[$index]}" ]]; then
                printf 'This ALSA source did not expose card/device ids via wpctl inspect. Choose another source.\n'
                continue
            fi

            SELECTED_SOURCE_ID="${SOURCE_IDS[$index]}"
            SELECTED_SOURCE_NAME="${SOURCE_NAMES[$index]}"
            SELECTED_SOURCE_KIND="${SOURCE_KINDS[$index]}"
            SELECTED_SOURCE_API="${SOURCE_APIS[$index]}"
            SELECTED_SOURCE_BACKEND="${SOURCE_BACKENDS[$index]}"
            return 0
        fi

        printf 'Invalid selection.\n'
    done
}

select_sink_device() {
    local choice
    local count="${#SINK_IDS[@]}"
    local index

    printf '\n'
    printf 'Audio sink devices\n'

    while true; do
        for index in "${!SINK_IDS[@]}"; do
            print_device_entry "$((index + 1))" "${SINK_IDS[$index]}" "${SINK_NAMES[$index]}" "${SINK_DEFAULTS[$index]}" "${SINK_KINDS[$index]}" "${SINK_APIS[$index]}" "${SINK_BACKENDS[$index]}"
        done

        printf 'Select sink device [1-%d]: ' "$count"
        IFS= read -r choice

        if [[ "$choice" =~ ^[0-9]+$ && "$choice" -ge 1 && "$choice" -le "$count" ]]; then
            index="$((choice - 1))"
            if [[ "${SINK_KINDS[$index]}" == "ALSA" && -z "${SINK_BACKENDS[$index]}" ]]; then
                printf 'This ALSA sink did not expose card/device ids via wpctl inspect. Choose another sink.\n'
                continue
            fi

            SELECTED_SINK_ID="${SINK_IDS[$index]}"
            SELECTED_SINK_NAME="${SINK_NAMES[$index]}"
            SELECTED_SINK_KIND="${SINK_KINDS[$index]}"
            SELECTED_SINK_API="${SINK_APIS[$index]}"
            SELECTED_SINK_BACKEND="${SINK_BACKENDS[$index]}"
            return 0
        fi

        printf 'Invalid selection.\n'
    done
}

print_selected_devices() {
    printf '\n'
    printf 'Selected devices\n'
    printf '  Source: [%s] %s -> %s\n' "$SELECTED_SOURCE_KIND" "$SELECTED_SOURCE_NAME" "$SELECTED_SOURCE_BACKEND"
    printf '  Sink:   [%s] %s -> %s\n' "$SELECTED_SINK_KIND" "$SELECTED_SINK_NAME" "$SELECTED_SINK_BACKEND"
}

confirm_bridge_start() {
    local answer

    while true; do
        printf '\n'
        printf 'Establish the PipeWire-to-ALSA bridge now? [y/N]: '
        IFS= read -r answer

        case "$answer" in
            y|Y|yes|YES|Yes) return 0 ;;
            ''|n|N|no|NO|No) return 1 ;;
            *) printf 'Please answer yes or no.\n' ;;
        esac
    done
}

print_names_and_exit() {
    printf '\n'
    printf 'Bridge not started. No config changes were made.\n'
    printf '\n'
    printf 'Selected backend device names\n'
    printf '  Source: %s\n' "$SELECTED_SOURCE_BACKEND"
    printf '  Sink:   %s\n' "$SELECTED_SINK_BACKEND"
    printf '\n'
    printf 'EffectStreamer bridge device names if started later\n'
    printf '  client.audioDevices.source: %s\n' "$EST_SOURCE_DEVICE"
    printf '  client.audioDevices.sink:   %s\n' "$EST_SINK_DEVICE"
}

set_pipewire_defaults() {
    if [[ "$SELECTED_SOURCE_KIND" == "PipeWire" ]]; then
        printf '\n'
        printf 'Setting default PipeWire source: %s (%s)\n' "$SELECTED_SOURCE_NAME" "$SELECTED_SOURCE_ID"
        wpctl set-default "$SELECTED_SOURCE_ID"
        SOURCE_DEFAULT_CHANGED="1"
    fi

    if [[ "$SELECTED_SINK_KIND" == "PipeWire" ]]; then
        printf 'Setting default PipeWire sink: %s (%s)\n' "$SELECTED_SINK_NAME" "$SELECTED_SINK_ID"
        wpctl set-default "$SELECTED_SINK_ID"
        SINK_DEFAULT_CHANGED="1"
    fi
}

update_est_config() {
    local tmp_path
    local line
    local indent
    local trailing_comma
    local source_value
    local sink_value
    local in_client=0
    local in_audio_devices=0
    local brace_depth=0
    local source_updated=0
    local sink_updated=0

    if [[ ! -f "$CONFIG_PATH" ]]; then
        die "est-gui config file not found: $CONFIG_PATH"
    fi

    if command_exists jq; then
        CONFIG_RESTORE_PATH="$CONFIG_PATH"
        capture_est_config_restore_state_with_jq || die 'Could not capture current est-gui config values with jq.'
        tmp_path="$(create_temp_config_path)"

        if jq --arg source "$EST_SOURCE_DEVICE" --arg sink "$EST_SINK_DEVICE" \
            '.client.audioDevices.source = $source | .client.audioDevices.sink = $sink' \
            "$CONFIG_PATH" > "$tmp_path" && mv "$tmp_path" "$CONFIG_PATH"; then
            CONFIG_RESTORE_METHOD="jq"
            CONFIG_UPDATED="1"
            printf 'Updated est-gui config: %s\n' "$CONFIG_PATH"
            printf '  client.audioDevices.source: %s\n' "$EST_SOURCE_DEVICE"
            printf '  client.audioDevices.sink:   %s\n' "$EST_SINK_DEVICE"
            return 0
        fi

        rm -f "$tmp_path"
        die 'jq failed to update est-gui config. Check that the config file contains valid JSON.'
    fi

    source_value="${EST_SOURCE_DEVICE//\\/\\\\}"
    source_value="${source_value//\"/\\\"}"
    sink_value="${EST_SINK_DEVICE//\\/\\\\}"
    sink_value="${sink_value//\"/\\\"}"
    CONFIG_RESTORE_PATH="$CONFIG_PATH"
    ORIGINAL_CONFIG_SOURCE_LINE=""
    ORIGINAL_CONFIG_SINK_LINE=""
    tmp_path="$(create_temp_config_path)"

    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" =~ ^([[:space:]]*)\"client\"[[:space:]]*:[[:space:]]*\{ ]]; then
            in_client=1
            brace_depth=1
        elif [[ "$in_client" == "1" ]]; then
            if [[ "$line" == *"{"* ]]; then
                brace_depth="$((brace_depth + 1))"
            fi

            if [[ "$line" =~ ^[[:space:]]*\"audioDevices\"[[:space:]]*:[[:space:]]*\{ ]]; then
                in_audio_devices=1
            elif [[ "$in_audio_devices" == "1" && "$line" =~ ^([[:space:]]*)\"source\"[[:space:]]*: ]]; then
                indent="${BASH_REMATCH[1]}"
                trailing_comma=""
                [[ "$line" =~ ,[[:space:]]*$ ]] && trailing_comma=","
                ORIGINAL_CONFIG_SOURCE_LINE="$line"
                printf '%s"source": "%s"%s\n' "$indent" "$source_value" "$trailing_comma" >> "$tmp_path"
                source_updated=1
                continue
            elif [[ "$in_audio_devices" == "1" && "$line" =~ ^([[:space:]]*)\"sink\"[[:space:]]*: ]]; then
                indent="${BASH_REMATCH[1]}"
                trailing_comma=""
                [[ "$line" =~ ,[[:space:]]*$ ]] && trailing_comma=","
                ORIGINAL_CONFIG_SINK_LINE="$line"
                printf '%s"sink": "%s"%s\n' "$indent" "$sink_value" "$trailing_comma" >> "$tmp_path"
                sink_updated=1
                continue
            fi
        fi

        printf '%s\n' "$line" >> "$tmp_path"

        if [[ "$in_client" == "1" && "$line" == *"}"* ]]; then
            brace_depth="$((brace_depth - 1))"
            if [[ "$in_audio_devices" == "1" && "$brace_depth" -le 1 ]]; then
                in_audio_devices=0
            fi
            if [[ "$brace_depth" -le 0 ]]; then
                in_client=0
            fi
        fi
    done < "$CONFIG_PATH"

    if [[ "$source_updated" != "1" || "$sink_updated" != "1" ]]; then
        rm -f "$tmp_path"
        die 'Could not update client.audioDevices.source and client.audioDevices.sink in est-gui config.'
    fi

    if ! mv "$tmp_path" "$CONFIG_PATH"; then
        rm -f "$tmp_path"
        die 'Could not replace est-gui config with updated values.'
    fi

    CONFIG_RESTORE_METHOD="lines"
    CONFIG_UPDATED="1"

    printf 'Updated est-gui config: %s\n' "$CONFIG_PATH"
    printf '  client.audioDevices.source: %s\n' "$EST_SOURCE_DEVICE"
    printf '  client.audioDevices.sink:   %s\n' "$EST_SINK_DEVICE"
}

print_file_prefixed() {
    local file_path="$1"
    local line

    if [[ ! -s "$file_path" ]]; then
        printf '  (no log output)\n'
        return 0
    fi

    while IFS= read -r line; do
        printf '  %s\n' "$line"
    done < "$file_path"
}

start_gstreamer_bridge_process() {
    local label="$1"
    local capture_device="$2"
    local playback_device="$3"
    local log_file="$4"
    local pid

    printf '\n'
    printf 'Starting %s bridge: gst-launch-1.0 alsasrc device=%s -> alsasink device=%s\n' "$label" "$capture_device" "$playback_device"
    gst-launch-1.0 -v \
        alsasrc "device=${capture_device}" do-timestamp=true provide-clock=false buffer-time=20000 latency-time=5000 \
        '!' audioconvert \
        '!' audioresample \
        '!' audio/x-raw,format=S16LE,rate=48000,channels=1 \
        '!' queue max-size-time=200000000 leaky=downstream \
        '!' alsasink "device=${playback_device}" sync=false async=false buffer-time=20000 latency-time=5000 \
        >"$log_file" 2>&1 &
    pid="$!"

    if [[ "$label" == "sender" ]]; then
        SENDER_LOOP_PID="$pid"
    else
        RECEIVER_LOOP_PID="$pid"
    fi

    sleep 1
    if ! process_alive "$pid"; then
        printf '%s bridge exited immediately. Log output:\n' "$label" >&2
        print_file_prefixed "$log_file" >&2
        die "Failed to start $label GStreamer bridge. If a PipeWire device was selected, make sure the ALSA PipeWire PCM plugin is installed."
    fi
}

start_bridge_processes() {
    local sender_log
    local receiver_log

    BRIDGE_LOG_DIR="$(create_bridge_log_dir)"
    sender_log="${BRIDGE_LOG_DIR}/sender-gstreamer.log"
    receiver_log="${BRIDGE_LOG_DIR}/receiver-gstreamer.log"

    start_gstreamer_bridge_process "sender" "$SELECTED_SOURCE_BACKEND" "$SOURCE_BRIDGE_PLAYBACK" "$sender_log"
    printf 'Waiting for source bridge and Bluetooth profile to settle...\n'
    sleep 3
    start_gstreamer_bridge_process "receiver" "$SINK_BRIDGE_CAPTURE" "$SELECTED_SINK_BACKEND" "$receiver_log"
}

monitor_bridge() {
    local frames=(
        '⠋'
        '⠙'
        '⠚'
        '⠞'
        '⠖'
        '⠦'
        '⠴'
        '⠲'
        '⠳'
        '⠓'
    )
    local frame_index=0
    local frame_count="${#frames[@]}"
    local sender_log="${BRIDGE_LOG_DIR}/sender-gstreamer.log"
    local receiver_log="${BRIDGE_LOG_DIR}/receiver-gstreamer.log"

    printf '\n'
    printf 'Audio bridge is running.\n'
    printf 'Press Ctrl + C to shutdown the audio bridge.\n\n'

    while process_alive "$SENDER_LOOP_PID" && process_alive "$RECEIVER_LOOP_PID"; do
        printf '\r%s PipeWire-to-ALSA bridge is running...' "${frames[$frame_index]}"
        frame_index="$(((frame_index + 1) % frame_count))"
        sleep 0.08
    done

    printf '\n' >&2
    printf '\n' >&2
    printf 'One of the bridge processes stopped unexpectedly.\n' >&2

    if ! process_alive "$SENDER_LOOP_PID"; then
        printf 'Sender bridge log:\n' >&2
        print_file_prefixed "$sender_log" >&2
    fi

    if ! process_alive "$RECEIVER_LOOP_PID"; then
        printf 'Receiver bridge log:\n' >&2
        print_file_prefixed "$receiver_log" >&2
    fi

    printf 'Full bridge logs are in: %s\n' "$BRIDGE_LOG_DIR" >&2
    return 1
}

main() {
    assert_non_root
    prompt_device_connected
    require_commands
    load_loopback_module
    parse_wpctl_status
    select_source_device
    select_sink_device
    print_selected_devices

    if ! confirm_bridge_start; then
        print_names_and_exit
        return 0
    fi

    prompt_config_path
    set_pipewire_defaults
    update_est_config
    start_bridge_processes
    monitor_bridge
}

main "$@"
