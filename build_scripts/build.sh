#!/bin/bash
set -e

# Create output directory
mkdir -p out

# Bundle application
npx ncc build index.js -o dist

# Generate SEA blob
node --experimental-sea-config sea-config.json

# Create executable and ensure write permissions
cp $(command -v node) out/est-server
chmod +w out/est-server

# Inject blob
npx postject out/est-server NODE_SEA_BLOB out/sea.blob \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

echo "Build complete. Executable created: out/est-server"
