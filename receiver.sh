#!/bin/bash

# ╔═══════════════════════════════════════╗
# ║ Quality and Usability Lab / TU Berlin ║
# ║ EffectStreamer (Receiver)             ║
# ╚═══════════════════════════════════════╝

# Initialize variables
DEVICE=""
NATIVEGAIN="1.0"
ECHOGAIN="1.0"

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --device)
            DEVICE="$2"
            shift 2
            ;;
        --native-gain)
            NATIVEGAIN="$2"
            shift 2
            ;;
        --echo-gain)
            ECHOGAIN="$2"
            shift 2
            ;;
        *)
            echo "Unknown parameter: $1"
            exit 1
            ;;
    esac
done

# Check that required parameters are provided
if [[ -z "$DEVICE" ]]; then
    echo "Usage: $0 --device <DEVICE-ID> [--native-gain <GAIN>] [--echo-gain <GAIN>]"
    exit 1
fi

# Create session directory
SESSION_DIR="${HOME}/effectstreamer"
mkdir -p "${SESSION_DIR}"

# Recording paths
RECORD_FILE_MICROPHONE="${SESSION_DIR}/microphone.ogg"
RECORD_FILE_HEADPHONES="${SESSION_DIR}/headphones.ogg"

# Run GStreamer receivers
chrt -f 99 gst-launch-1.0 -e -v \
    adder name=add ! tee name=t ! \
        queue ! audioconvert ! audioresample ! alsasink device="${DEVICE}" buffer-time=5000 latency-time=1000 sync=false t. ! \
        queue ! audioconvert ! audioresample ! opusenc bitrate=128000 ! oggmux ! filesink location="${RECORD_FILE_HEADPHONES}" sync=false async=false \
    udpsrc port=9004 caps="application/x-rtp,media=audio,encoding-name=L16,clock-rate=48000,channels=1,payload=96" ! \
        rtpjitterbuffer latency=5 drop-on-latency=true ! rtpL16depay ! audioconvert ! \
        audio/x-raw,channels=1,rate=48000 ! volume volume=${NATIVEGAIN} ! add. \
    udpsrc port=9005 caps="application/x-rtp,media=audio,encoding-name=L16,clock-rate=48000,channels=1,payload=96" ! \
        rtpjitterbuffer latency=5 drop-on-latency=true ! rtpL16depay ! audioconvert ! \
        audio/x-raw,channels=1,rate=48000 ! volume volume=${ECHOGAIN} ! add. \
    udpsrc port=9006 caps="application/x-rtp,media=audio,encoding-name=L16,clock-rate=48000,channels=1,payload=96" ! \
        rtpjitterbuffer latency=5 drop-on-latency=true ! rtpL16depay ! audioconvert ! \
        opusenc bitrate=128000 ! oggmux ! filesink location="${RECORD_FILE_MICROPHONE}" sync=false async=false
