#!/bin/bash

# ╔═══════════════════════════════════════╗
# ║ Quality and Usability Lab / TU Berlin ║
# ║ EffectStreamer (Sender)               ║
# ╚═══════════════════════════════════════╝

# Initialize variables
DEVICE=""
PEERIP=""
ECHODELAY=""

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --device)
            DEVICE="$2"
            shift 2
            ;;
        --peerip)
            PEERIP="$2"
            shift 2
            ;;
        --echo-delay)
            ECHODELAY="$2"
            shift 2
            ;;
        *)
            echo "Unknown parameter: $1"
            exit 1
            ;;
    esac
done

# Check that required parameters are provided
if [[ -z "$DEVICE" || -z "$PEERIP" || -z "$ECHODELAY" ]]; then
    echo "Usage: $0 --device <DEVICE-ID> --peerip <IP-ADDRESS> --echo-delay <MS>"
    exit 1
fi

# Adjust supplied threshold, so it aligns with real world measurements
if [ "$ECHODELAY" -le 20 ]; then
    THRESHOLD_ADJUSTED=0
else
    THRESHOLD_ADJUSTED=$((ECHODELAY - 20))
fi

# Run GStreamer sender
chrt -f 99 gst-launch-1.0 -e -v \
    alsasrc device=${DEVICE} buffer-time=5000 latency-time=1000 ! \
    audioconvert ! audioresample ! audio/x-raw,format=S16BE,channels=1,rate=48000 ! \
    rtpL16pay pt=96 ! tee name=t ! \
        queue max-size-buffers=0 max-size-bytes=0 max-size-time=0 min-threshold-time=0 ! udpsink host=${PEERIP} port=9004 sync=false t. ! \
        queue max-size-buffers=0 max-size-bytes=0 max-size-time=0 min-threshold-time=$((THRESHOLD_ADJUSTED * 1000000)) ! udpsink host=127.0.0.1 port=9005 sync=false t. ! \
        queue max-size-buffers=0 max-size-bytes=0 max-size-time=0 min-threshold-time=0 ! udpsink host=127.0.0.1 port=9006 sync=false
