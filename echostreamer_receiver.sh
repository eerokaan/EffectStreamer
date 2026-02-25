#!/bin/bash

# ╔═══════════════════════════════════════╗
# ║ Quality and Usability Lab / TU Berlin ║
# ║ EchoStreamer (Receiver)               ║
# ╚═══════════════════════════════════════╝

# Initialize variables
DEVICE=""
GAIN=""

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --device)
            DEVICE="$2"
            shift 2
            ;;
        --gain)
            GAIN="$2"
            shift 2
            ;;
        *)
            echo "Unknown parameter: $1"
            exit 1
            ;;
    esac
done

# Check that required parameters are provided
if [[ -z "$DEVICE" || -z "$GAIN" ]]; then
    echo "Usage: $0 --device <ALSA-SINK-DEVICE> --gain <GAIN>"
    exit 1
fi

# Create session directory
SESSION_DIR="session-$(date +%s)"
mkdir -p "${SESSION_DIR}"

# Define recording paths
RECORD_FILE_MICROPHONE="${SESSION_DIR}/${SESSION_DIR}-microphone.ogg"
RECORD_FILE_HEADPHONES="${SESSION_DIR}/${SESSION_DIR}-headphones.ogg"

# Run GStreamer receivers
chrt -f 99 gst-launch-1.0 -e -v \
    adder name=add ! tee name=t \
        t. ! queue ! audioconvert ! audioresample ! alsasink device=${DEVICE} buffer-time=5000 latency-time=1000 sync=false async=false \
        t. ! queue ! audioconvert ! audioresample ! opusenc bitrate=128000 ! oggmux ! filesink location=${RECORD_FILE_HEADPHONES} sync=false async=false \
        udpsrc port=9004 caps="application/x-rtp,media=audio,encoding-name=L16,clock-rate=48000,channels=1,payload=96" ! \
            rtpjitterbuffer latency=5 drop-on-latency=true ! rtpL16depay ! audioconvert ! \
            audio/x-raw,format=S16LE,channels=1,rate=48000 ! volume volume=1.0 ! add. \
        udpsrc port=9005 caps="application/x-rtp,media=audio,encoding-name=L16,clock-rate=48000,channels=1,payload=96" ! \
            rtpjitterbuffer latency=5 drop-on-latency=true ! rtpL16depay ! audioconvert ! \
            audio/x-raw,format=S16LE,channels=1,rate=48000 ! volume volume=${GAIN} ! add. \
    udpsrc port=9006 caps="application/x-rtp,media=audio,encoding-name=L16,clock-rate=48000,channels=1,payload=96" ! \
        rtpjitterbuffer latency=5 drop-on-latency=true ! rtpL16depay ! audioconvert ! \
        opusenc bitrate=128000 ! oggmux ! filesink location=${RECORD_FILE_MICROPHONE} sync=false async=false
