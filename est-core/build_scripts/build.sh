#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source "$root/../common/transient-paths.sh"
target=${TARGET_OS:-linux}
case "$target" in
    linux) triple=linux_x86_64; compiler=${CC:-gcc}; platform=linux; extension= ;;
    win) triple=mingw_x86_64; compiler=${CC:-x86_64-w64-mingw32-gcc}; platform=windows; extension=.exe ;;
    *) echo "TARGET_OS must be linux or win" >&2; exit 1 ;;
esac
sdk=${SDK:-"$root/gst-sdk/build/dist/$triple"}
if [[ ! -d "$sdk/include/gstreamer-1.0" ]]; then
    echo "GStreamer SDK headers not found at $sdk; set SDK to the matching $target SDK" >&2
    exit 1
fi
sdk=$(cd -- "$sdk" && pwd)
if [[ "$target" == linux ]]; then lib="$sdk/lib/x86_64-linux-gnu"; else lib="$sdk/lib"; fi
export PKG_CONFIG_LIBDIR="$lib/pkgconfig:$sdk/share/pkgconfig${EST_PKG_CONFIG_EXTRA_PATH:+:$EST_PKG_CONFIG_EXTRA_PATH}"
export PKG_CONFIG_PATH="$PKG_CONFIG_LIBDIR"
export PKG_CONFIG_SYSROOT_DIR="$sdk"
export LIBRARY_PATH="$lib"
est_transient_prepare "$root/.." est-core
output=${EST_CORE_OUTPUT:-"$EST_TRANSIENT_BASE/est-core/build/$target/est-core$extension"}
est_transient_validate_output "$output"
est_transient_acquire_lock "$target"
trap est_transient_release_lock EXIT
est_transient_ensure "$(dirname -- "$output")"
gst_flags_text=$(pkg-config --cflags --libs gstreamer-1.0 gstreamer-sdp-1.0 gstreamer-webrtc-1.0)
read -r -a gst_flags <<< "$gst_flags_text"
link_flags=()
if [[ "$target" == linux ]]; then
    link_flags=("-Wl,-rpath-link,$lib" '-Wl,-rpath,$ORIGIN/gst-lib/x86_64-linux-gnu/lib')
fi
"$compiler" -DGST_USE_UNSTABLE_API -Wall -Wextra -I"$root/est-src" -I"$root/est-src/stdin" -I"$root/est-deps/cJSON" \
    "$root/est-src/main.c" "$root/est-src/transient.c" "$root/est-src/modes/sender.c" "$root/est-src/modes/receiver.c" \
    "$root/est-src/stdin/receiverstdin.c" "$root/est-src/device/deviceutils.c" \
    "$root/est-src/platform/$platform.c" "$root/est-src/control/control.c" "$root/est-src/lifecycle.c" \
    "$root/est-src/recording/wav.c" \
    "$root/est-src/device/discovery.c" "$root/est-src/device/devicecheck.c" \
    "$root/est-src/device/webrtc.c" \
    "$root/est-deps/cJSON/cJSON.c" "${gst_flags[@]}" "${link_flags[@]}" -o "$output"
echo "Built $output (GStreamer $(pkg-config --modversion gstreamer-1.0))"
