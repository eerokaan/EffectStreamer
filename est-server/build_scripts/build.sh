#!/bin/bash
set -e

if [ "$TARGET_OS" != "linux" ] && [ "$TARGET_OS" != "win" ]; then
    echo "Error: TARGET_OS must be set to 'linux' or 'win'"
    exit 1
fi

NODE_VERSION="${NODE_VERSION:-$(node -v | sed 's/^v//')}"
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

# Clean and create output directories
rm -rf out dist
mkdir -p out dist

# Bundle application
npx ncc build src/index.js -o out

# Generate SEA blob
node --experimental-sea-config sea-config.json

if [ "$TARGET_OS" = "linux" ]; then
    cp $(command -v node) dist/est-server
    chmod +w dist/est-server
    npx postject dist/est-server NODE_SEA_BLOB out/sea.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
elif [ "$TARGET_OS" = "win" ]; then
    NODE_EXE="out/node.exe"
    curl -sL "https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe" -o "$NODE_EXE"
    chmod +w "$NODE_EXE"
    cp "$NODE_EXE" "dist/est-server.exe"
    chmod +w "dist/est-server.exe"
    npx postject dist/est-server.exe NODE_SEA_BLOB out/sea.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
fi

# Copy config to dist
cp est-config.json dist/est-config.json

# Finish
echo "Build complete. Executable and config created in dist/"
