#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
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
export PKG_CONFIG_LIBDIR="$lib/pkgconfig:$sdk/share/pkgconfig"
export PKG_CONFIG_PATH="$PKG_CONFIG_LIBDIR"
export PKG_CONFIG_SYSROOT_DIR="$sdk"
export LIBRARY_PATH="$lib"
output=${EST_CORE_OUTPUT:-"$root/.build/$target/est-core$extension"}
mkdir -p -- "$(dirname -- "$output")"
read -r -a gst_flags <<< "$(pkg-config --cflags --libs gstreamer-1.0)"
link_flags=()
if [[ "$target" == linux ]]; then
    link_flags=("-Wl,-rpath-link,$lib" '-Wl,-rpath,$ORIGIN/gst-lib/x86_64-linux-gnu/lib')
fi
"$compiler" -Wall -Wextra -I"$root/est-src" -I"$root/est-src/stdin" -I"$root/est-deps/cJSON" \
    "$root/est-src/main.c" "$root/est-src/modes/sender.c" "$root/est-src/modes/receiver.c" \
    "$root/est-src/stdin/receiverstdin.c" "$root/est-src/device/deviceutils.c" \
    "$root/est-src/platform/$platform.c" "$root/est-src/control/control.c" "$root/est-src/lifecycle.c" \
    "$root/est-deps/cJSON/cJSON.c" "${gst_flags[@]}" "${link_flags[@]}" -o "$output"
echo "Built $output (GStreamer $(pkg-config --modversion gstreamer-1.0))"
