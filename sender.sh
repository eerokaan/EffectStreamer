#!/bin/bash

# ╔═══════════════════════════════════════╗
# ║ Quality and Usability Lab / TU Berlin ║
# ║ EffectStreamer (Sender)               ║
# ╚═══════════════════════════════════════╝

# Initialize variables
DEVICE=""
PEERIP=""
NATIVEDELAY="0"
ECHODELAY="0"

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
        --native-delay)
            NATIVEDELAY="$2"
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
if [[ -z "$DEVICE" || -z "$PEERIP" ]]; then
    echo "Usage: $0 --device <DEVICE-ID> --peerip <IP-ADDRESS> [--native-delay <MS>] [--echo-delay <MS>]"
    exit 1
fi

# Adjust thresholds, so they account for real world end-to-end latencies
if [ "$NATIVEDELAY" -le 20 ]; then
    NATIVEDELAY_ADJUSTED=0
else
    NATIVEDELAY_ADJUSTED=$(((NATIVEDELAY - 20) * 1000000))
fi

if [ "$ECHODELAY" -le 20 ]; then
    ECHODELAY_ADJUSTED=0
else
    ECHODELAY_ADJUSTED=$(((ECHODELAY - 20) * 1000000))
fi

# Run GStreamer sender
chrt -f 99 gst-launch-1.0 -e -v \
    alsasrc device="${DEVICE}" buffer-time=5000 latency-time=1000 ! \
    audioconvert ! audioresample ! audio/x-raw,format=S16BE,channels=1,rate=48000 ! \
    rtpL16pay pt=96 ! tee name=t ! \
        queue max-size-buffers=0 max-size-bytes=0 max-size-time=0 min-threshold-time=${NATIVEDELAY_ADJUSTED} ! udpsink host="${PEERIP}" port=9004 sync=false t. ! \
        queue max-size-buffers=0 max-size-bytes=0 max-size-time=0 min-threshold-time=${ECHODELAY_ADJUSTED} ! udpsink host=127.0.0.1 port=9005 sync=false t. ! \
        queue max-size-buffers=0 max-size-bytes=0 max-size-time=0 min-threshold-time=0 ! udpsink host=127.0.0.1 port=9006 sync=false
