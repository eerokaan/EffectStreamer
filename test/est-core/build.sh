#!/usr/bin/env bash
# Source the application build to share its SDK setup and retain its output lock
# until the integration peer has finished compiling.
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)/est-core/build_scripts/build.sh"

fixtures="$root/../test/est-core/fixtures"
fixtures=$(cd -- "$fixtures" && pwd)
"$compiler" -DGST_USE_UNSTABLE_API -Wall -Wextra -I"$root/est-src" -I"$root/est-src/stdin" -I"$root/est-deps/cJSON" \
    "$fixtures/webrtc-peer.c" "$root/est-src/transient.c" "$root/est-src/control/control.c" "$root/est-src/platform/$platform.c" \
    "$root/est-src/stdin/receiverstdin.c" "$root/est-deps/cJSON/cJSON.c" "$fixtures/peer-support.c" \
    "${gst_flags[@]}" "${link_flags[@]}" -o "$(dirname -- "$output")/webrtc-peer$extension"
