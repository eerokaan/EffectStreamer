#!/bin/bash

# ╔═══════════════════════════════════════╗
# ║ Quality and Usability Lab / TU Berlin ║
# ║ EffectStreamer (Receiver)             ║
# ╚═══════════════════════════════════════╝

# Initialize variables
DEVICE=""
ECHOGAIN=""

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --device)
            DEVICE="$2"
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
if [[ -z "$DEVICE" || -z "$ECHOGAIN" ]]; then
    echo "Usage: $0 --device <DEVICE-ID> --echo-gain <GAIN>"
    exit 1
fi

# Create session directory
SESSION_DIR="session-$(date +%s)"
mkdir -p "${SESSION_DIR}"

# Prepend session directory to record file path
RECORD_FILE="${SESSION_DIR}/${SESSION_DIR}.ogg"

# Run GStreamer receivers
chrt -f 99 gst-launch-1.0 -e -v \
    adder name=add ! audioconvert ! audioresample ! alsasink device=${DEVICE} buffer-time=5000 latency-time=1000 sync=false \
    udpsrc port=9004 caps="application/x-rtp,media=audio,encoding-name=L16,clock-rate=48000,channels=1,payload=96" ! \
        rtpjitterbuffer latency=5 drop-on-latency=true ! rtpL16depay ! audioconvert ! \
        audio/x-raw,channels=1,rate=48000 ! volume volume=1.0 ! add. \
    udpsrc port=9005 caps="application/x-rtp,media=audio,encoding-name=L16,clock-rate=48000,channels=1,payload=96" ! \
        rtpjitterbuffer latency=5 drop-on-latency=true ! rtpL16depay ! audioconvert ! \
        audio/x-raw,channels=1,rate=48000 ! volume volume=${ECHOGAIN} ! add. \
    udpsrc port=9006 caps="application/x-rtp,media=audio,encoding-name=L16,clock-rate=48000,channels=1,payload=96" ! \
        rtpjitterbuffer latency=5 drop-on-latency=true ! rtpL16depay ! audioconvert ! \
        audio/x-raw,channels=1,rate=48000 ! volume volume=1.0 ! opusenc bitrate=128000 ! oggmux ! filesink location=${RECORD_FILE}
