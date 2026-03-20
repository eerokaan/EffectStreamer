const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

module.exports = async function (context) {
    const projectDir = path.resolve(__dirname, "..");
    const platform = context.electronPlatformName;

    let buildSubDir;
    if (platform === "linux") buildSubDir = "linux";
    else if (platform === "win32") buildSubDir = "win";
    else return;

    const buildDir = path.join(projectDir, "build", buildSubDir);
    const zipPath = path.join(buildDir, "gst-lib.zip");
    const extractedDir = path.join(buildDir, "gst-lib");

    if (!fs.existsSync(zipPath)) {
        console.warn("[beforePack] GStreamer libraries not found: " + zipPath);
        return;
    }
    if (fs.existsSync(extractedDir)) {
        console.log("[beforePack] GStreamer libraries already unpacked at " + extractedDir + ", skipping.");
        return;
    }

    console.log("[beforePack] Unpacking GStreamer libraries from " + zipPath + "...");

    if (platform === "win32") {
        execSync(
            "powershell -Command \"Expand-Archive -Path '" + zipPath + "' -DestinationPath '" + buildDir + "'\"",
            { stdio: "inherit" }
        );
    }
    else {
        execSync("unzip -q \"" + zipPath + "\" -d \"" + buildDir + "\"", { stdio: "inherit" });
    }

    console.log("[beforePack] GStreamer libraries unpacked successfully.");
};
