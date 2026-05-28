#!/bin/bash

# EffectStreamer Utilities: PipeWire-to-ALSA Bridge Test
# @company Quality and Usability Lab | TU Berlin
# @author  Eero Kaan <eerokaan@qu.tu-berlin.de>

set -Eeuo pipefail

SOURCE_BRIDGE_PLAYBACK="hw:Loopback,0,1"
SINK_BRIDGE_CAPTURE="hw:Loopback,1,0"
TEST_SOURCE_DEVICE="hw:Loopback,1,1"
TEST_SINK_DEVICE="hw:Loopback,0,0"

WPCTL_STATUS_OUTPUT=""
SOURCE_BRIDGE_PID=""
SINK_BRIDGE_PID=""
TEST_LOOPBACK_PID=""
ORIGINAL_SOURCE_DEFAULT_ID=""
ORIGINAL_SINK_DEFAULT_ID=""
SOURCE_DEFAULT_CHANGED="0"
SINK_DEFAULT_CHANGED="0"

SOURCE_IDS=()
SOURCE_NAMES=()
SOURCE_DEFAULTS=()
SOURCE_APIS=()

SINK_IDS=()
SINK_NAMES=()
SINK_DEFAULTS=()
SINK_APIS=()

SELECTED_SOURCE_ID=""
SELECTED_SOURCE_NAME=""
SELECTED_SOURCE_API=""

SELECTED_SINK_ID=""
SELECTED_SINK_NAME=""
SELECTED_SINK_API=""

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

    stop_process "$TEST_LOOPBACK_PID"
    stop_process "$SINK_BRIDGE_PID"
    stop_process "$SOURCE_BRIDGE_PID"
    restore_pipewire_defaults
}

handle_signal() {
    printf '\n'
    printf 'Shutting down audio bridge test...\n'
    exit 130
}

trap cleanup EXIT
trap handle_signal INT TERM

assert_non_root() {
    if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
        die 'Run this script as a normal user. PipeWire is usually tied to the desktop user session.'
    fi
}

require_commands() {
    local missing=0
    local cmd

    for cmd in sudo modprobe wpctl gst-launch-1.0; do
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
    printf 'PipeWire to ALSA bridge test setup\n'
    printf 'Connect the Bluetooth earbuds to this computer now.\n'
    printf 'Press any key to continue...'
    IFS= read -r -n 1 _
    printf '\n'
}

load_loopback_module() {
    local output

    printf '\n'
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

    if [[ "$device_type" == "source" ]]; then
        SOURCE_IDS+=("$id")
        SOURCE_NAMES+=("$display_name")
        SOURCE_DEFAULTS+=("$is_default")
        SOURCE_APIS+=("$api")
    else
        SINK_IDS+=("$id")
        SINK_NAMES+=("$display_name")
        SINK_DEFAULTS+=("$is_default")
        SINK_APIS+=("$api")
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
    local name="$2"
    local is_default="$3"
    local api="$4"
    local default_label=""

    if [[ "$is_default" == "1" ]]; then
        default_label=" default"
    fi

    printf '  %2d) [PipeWire/%s] %s%s\n' "$index" "$api" "$name" "$default_label"
}

select_source_device() {
    local choice
    local count="${#SOURCE_IDS[@]}"
    local index

    printf '\n'
    printf 'Audio source devices\n'

    while true; do
        for index in "${!SOURCE_IDS[@]}"; do
            print_device_entry "$((index + 1))" "${SOURCE_NAMES[$index]}" "${SOURCE_DEFAULTS[$index]}" "${SOURCE_APIS[$index]}"
        done

        printf 'Select source device [1-%d]: ' "$count"
        IFS= read -r choice

        if [[ "$choice" =~ ^[0-9]+$ && "$choice" -ge 1 && "$choice" -le "$count" ]]; then
            index="$((choice - 1))"
            SELECTED_SOURCE_ID="${SOURCE_IDS[$index]}"
            SELECTED_SOURCE_NAME="${SOURCE_NAMES[$index]}"
            SELECTED_SOURCE_API="${SOURCE_APIS[$index]}"
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
            print_device_entry "$((index + 1))" "${SINK_NAMES[$index]}" "${SINK_DEFAULTS[$index]}" "${SINK_APIS[$index]}"
        done

        printf 'Select sink device [1-%d]: ' "$count"
        IFS= read -r choice

        if [[ "$choice" =~ ^[0-9]+$ && "$choice" -ge 1 && "$choice" -le "$count" ]]; then
            index="$((choice - 1))"
            SELECTED_SINK_ID="${SINK_IDS[$index]}"
            SELECTED_SINK_NAME="${SINK_NAMES[$index]}"
            SELECTED_SINK_API="${SINK_APIS[$index]}"
            return 0
        fi

        printf 'Invalid selection.\n'
    done
}

print_selected_devices() {
    printf '\n'
    printf 'Selected devices\n'
    printf '  Source: [PipeWire/%s] %s\n' "$SELECTED_SOURCE_API" "$SELECTED_SOURCE_NAME"
    printf '  Sink:   [PipeWire/%s] %s\n' "$SELECTED_SINK_API" "$SELECTED_SINK_NAME"
}

set_pipewire_defaults() {
    printf '\n'
    printf 'Setting default PipeWire source for test: %s (%s)\n' "$SELECTED_SOURCE_NAME" "$SELECTED_SOURCE_ID"
    if [[ "$SELECTED_SOURCE_ID" != "$ORIGINAL_SOURCE_DEFAULT_ID" ]]; then
        SOURCE_DEFAULT_CHANGED="1"
    fi
    wpctl set-default "$SELECTED_SOURCE_ID"

    printf 'Setting default PipeWire sink for test: %s (%s)\n' "$SELECTED_SINK_NAME" "$SELECTED_SINK_ID"
    if [[ "$SELECTED_SINK_ID" != "$ORIGINAL_SINK_DEFAULT_ID" ]]; then
        SINK_DEFAULT_CHANGED="1"
    fi
    wpctl set-default "$SELECTED_SINK_ID"
}

assign_process_pid() {
    local label="$1"
    local pid="$2"

    case "$label" in
        source-bridge) SOURCE_BRIDGE_PID="$pid" ;;
        sink-bridge) SINK_BRIDGE_PID="$pid" ;;
        loopback-test) TEST_LOOPBACK_PID="$pid" ;;
    esac
}

start_gstreamer_process() {
    local label="$1"
    local capture_device="$2"
    local playback_device="$3"
    local pid

    printf '\n'
    printf 'Starting %s: gst-launch-1.0 alsasrc device=%s -> alsasink device=%s\n' "$label" "$capture_device" "$playback_device"
    gst-launch-1.0 \
        alsasrc "device=${capture_device}" do-timestamp=true provide-clock=false buffer-time=20000 latency-time=5000 \
        '!' audioconvert \
        '!' audioresample \
        '!' audio/x-raw,format=S16LE,rate=48000,channels=1 \
        '!' queue max-size-time=200000000 leaky=downstream \
        '!' alsasink "device=${playback_device}" sync=false async=false buffer-time=20000 latency-time=5000 \
        >/dev/null 2>&1 &
    pid="$!"
    assign_process_pid "$label" "$pid"

    sleep 1
    if ! process_alive "$pid"; then
        die "Failed to start $label."
    fi
}

start_test_processes() {
    start_gstreamer_process "source-bridge" "pipewire" "$SOURCE_BRIDGE_PLAYBACK"
    printf 'Waiting for source bridge and Bluetooth profile to settle...\n'
    sleep 3
    start_gstreamer_process "sink-bridge" "$SINK_BRIDGE_CAPTURE" "pipewire"
    start_gstreamer_process "loopback-test" "$TEST_SOURCE_DEVICE" "$TEST_SINK_DEVICE"
}

monitor_test() {
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

    printf '\n'
    printf 'Audio bridge test is running.\n'
    printf 'Speak into the selected source. You should hear yourself in the selected sink.\n'
    printf 'Press Ctrl + C to stop the test.\n'
    printf '\n'

    while process_alive "$SOURCE_BRIDGE_PID" && process_alive "$SINK_BRIDGE_PID" && process_alive "$TEST_LOOPBACK_PID"; do
        printf '\r%s PipeWire-to-ALSA audio test is running...' "${frames[$frame_index]}"
        frame_index="$(((frame_index + 1) % frame_count))"
        sleep 0.08
    done

    printf '\n\nOne of the GStreamer test processes stopped unexpectedly.\n' >&2

    if ! process_alive "$SOURCE_BRIDGE_PID"; then
        printf 'Source bridge stopped.\n' >&2
    fi

    if ! process_alive "$SINK_BRIDGE_PID"; then
        printf 'Sink bridge stopped.\n' >&2
    fi

    if ! process_alive "$TEST_LOOPBACK_PID"; then
        printf 'Loopback test stopped.\n' >&2
    fi

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
    set_pipewire_defaults
    start_test_processes
    monitor_test
}

main "$@"
