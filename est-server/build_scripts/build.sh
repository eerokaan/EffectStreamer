#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
target=${TARGET_OS:-linux}
case "$target" in linux) extension= ;; win) extension=.exe ;; *) echo 'TARGET_OS must be linux or win' >&2; exit 1 ;; esac
destination=${EST_DISTRIBUTION_DIR:-"$root/dist/$target"}
if [[ -e "$destination" ]]; then echo "Refusing to overwrite $destination; choose a new EST_DISTRIBUTION_DIR" >&2; exit 1; fi
: "${SDK:?Set SDK to the matching GStreamer SDK}"
: "${EST_NETSIM_PLUGIN:?Set EST_NETSIM_PLUGIN to the matching custom plugin}"
core=${EST_CORE_EXECUTABLE:-"$root/../est-core/.build/$target/est-core$extension"}
web=${EST_WEB_ROOT:-"$root/../est-gui/out/web"}
if [[ ! -f "$web/index.html" || ! -f "$web/audio/P501_C_german_f1_FB_48k.wav" ]]; then echo 'Build the shared web frontend first (npm --prefix est-gui run build:web)' >&2; exit 1; fi
mkdir -p -- "$root/out" "$(dirname -- "$destination")"
work=$(mktemp -d "$root/out/sea-$target-XXXXXX")
node "$root/node_modules/@vercel/ncc/dist/ncc/cli.js" build "$root/src/index.js" -o "$work/bundle"
WORK="$work" node - <<'JS'
const fs=require('node:fs'),path=require('node:path');
const work=process.env.WORK;
fs.writeFileSync(path.join(work,'sea.json'),JSON.stringify({main:path.join(work,'bundle/index.js'),output:path.join(work,'sea.blob'),disableExperimentalSEAWarning:true}));
JS
node --experimental-sea-config "$work/sea.json"
if [[ "$target" == linux ]]; then cp -- "$(command -v node)" "$work/est-server";
else
    version=${NODE_VERSION:-$(node -p 'process.versions.node')}
    curl --fail --location "https://nodejs.org/dist/v$version/win-x64/node.exe" -o "$work/est-server.exe"
fi
chmod u+w "$work/est-server$extension"
node "$root/node_modules/postject/dist/cli.js" "$work/est-server$extension" NODE_SEA_BLOB "$work/sea.blob" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
# Build resources under this invocation's scratch directory, then publish a new
# distribution. Never read or overwrite tracked GUI/core binaries or ZIPs.
TARGET_OS="$target" EST_CORE_EXECUTABLE="$core" node "$root/../est-core/build_scripts/stage-runtime.cjs" "$work/package/core"
mkdir -p "$work/package/web"
cp -a -- "$web/." "$work/package/web/"
cp -- "$work/est-server$extension" "$work/package/est-server$extension"
chmod u+x "$work/package/est-server$extension"
cp -- "$root/config-server.example.json" "$root/config-server.remote.example.json" "$work/package/"
cp -- "$root/README.md" "$work/package/README.md"
mv -- "$work/package" "$destination"
echo "Distribution: $destination"
