import { is } from "@electron-toolkit/utils";
import path from "path";

const setWindowContent = async (window, pageFile) => {
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
        await window.loadURL(process.env["ELECTRON_RENDERER_URL"] + "/" + pageFile);
    }
    else {
        await window.loadFile(path.join(__dirname, "../renderer/" + pageFile));
    }
};

export default setWindowContent;
