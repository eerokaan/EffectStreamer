#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source "$root/../common/transient-paths.sh"
target=${TARGET_OS:-linux}
case "$target" in linux) extension= ;; win) extension=.exe ;; *) echo 'TARGET_OS must be linux or win' >&2; exit 1 ;; esac
destination=${EST_DISTRIBUTION_DIR:-"$root/dist/$target"}
if [[ -e "$destination" ]]; then echo "Refusing to overwrite $destination; choose a new EST_DISTRIBUTION_DIR" >&2; exit 1; fi
: "${SDK:?Set SDK to the matching GStreamer SDK}"
: "${EST_NETSIM_PLUGIN:?Set EST_NETSIM_PLUGIN to the matching custom plugin}"
base=$(est_transient_base "$root/..")
core=${EST_CORE_EXECUTABLE:-"$base/est-core/build/$target/est-core$extension"}
web=${EST_WEB_ROOT:-"$base/est-gui/web"}
if [[ ! -f "$web/index.html" || ! -f "$web/audio/P501_C_german_f1_FB_48k.wav" ]]; then echo 'Build the shared web frontend first (npm --prefix est-gui run build:web)' >&2; exit 1; fi
est_transient_prepare "$root/.." est-server
mkdir -p -- "$(dirname -- "$destination")"
mkdir -m 700 -- "$destination"
trap 'echo "Build failed; incomplete distribution may remain at $destination" >&2' ERR
work=$EST_TRANSIENT_RUN_DIR
node "$root/node_modules/@vercel/ncc/dist/ncc/cli.js" build "$root/src/index.js" -o "$work/bundle"
WORK="$work" node - <<'JS'
const fs=require('node:fs'),path=require('node:path');
const work=process.env.WORK;
fs.writeFileSync(path.join(work,'sea.json'),JSON.stringify({main:path.join(work,'bundle/index.js'),output:path.join(work,'sea.blob'),disableExperimentalSEAWarning:true}));
JS
node --experimental-sea-config "$work/sea.json"
if [[ "$target" == linux ]]; then cp -- "$(command -v node)" "$destination/est-server";
else
    version=${NODE_VERSION:-$(node -p 'process.versions.node')}
    curl --fail --location "https://nodejs.org/dist/v$version/win-x64/node.exe" -o "$destination/est-server.exe"
fi
chmod u+w "$destination/est-server$extension"
node "$root/node_modules/postject/dist/cli.js" "$destination/est-server$extension" NODE_SEA_BLOB "$work/sea.blob" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
# Assemble directly at the final destination; failures may leave partial output.
TARGET_OS="$target" EST_CORE_EXECUTABLE="$core" node "$root/../est-core/build_scripts/stage-runtime.cjs" "$destination/core"
mkdir -p "$destination/web"
cp -a -- "$web/." "$destination/web/"
chmod u+x "$destination/est-server$extension"
cp -- "$root/config-server.example.json" "$root/config-server.remote.example.json" "$destination/"
cp -- "$root/README.md" "$destination/README.md"
echo "Distribution: $destination"
