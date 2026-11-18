import listeningSpeakingTestCss from "@/assets/css/listening-speaking-test.css?raw";
import shortConversationTestCss from "@/assets/css/short-conversation-test.css?raw";
import firaCodeFontUrl from "@/assets/fonts/FiraCode.ttf?url";
import interFontUrl from "@/assets/fonts/Inter.ttf?url";

const taskDocuments = import.meta.glob("../assets/html/{short-conversation-test,listening-speaking-test}/{client-a,client-b}/*.html", { eager: true, query: "?raw", import: "default" });
const localizedImages = import.meta.glob("../assets/img/{scales,short-conversation-test,listening-speaking-test}/{en,de}/*.png", { eager: true, query: "?url", import: "default" });
const sharedIcons = import.meta.glob("../assets/img/short-conversation-test/icons/*.png", { eager: true, query: "?url", import: "default" });

const fontUrlByRelativePath = {
    "../fonts/Inter.ttf": interFontUrl,
    "../fonts/FiraCode.ttf": firaCodeFontUrl
};

function inlineStylesheet(css) {
    return css
        .replace(/url\(["']?([^"')]+)["']?\)/g, (match, fontPath) => (Object.hasOwn(fontUrlByRelativePath, fontPath) ? `url("${fontUrlByRelativePath[fontPath]}")` : match))
        .replace(/<\/style/gi, "<\\/style");
}

const stylesheetByRelativePath = {
    "../../../css/short-conversation-test.css": inlineStylesheet(shortConversationTestCss),
    "../../../css/listening-speaking-test.css": inlineStylesheet(listeningSpeakingTestCss)
};

const iconUrlByRelativePath = Object.fromEntries(Object.entries(sharedIcons).map(([path, url]) => [path.replace("../assets/", "../../../"), url]));
const textTargets = new Set(["title", "h1", "div", "p", "span", "li", "td", "th"]);

class StudyAssetError extends Error {}

function requireLanguage(language) {
    if (language !== "en" && language !== "de") throw new StudyAssetError(`Unsupported study asset language: ${language}`);
}

function getExactAsset(assets, key) {
    if (!Object.hasOwn(assets, key)) throw new StudyAssetError(`Missing study asset: ${key}`);
    return assets[key];
}

function resolveLocalizedImage(group, basename, language) {
    requireLanguage(language);
    return getExactAsset(localizedImages, `../assets/img/${group}/${language}/${basename}`);
}

function localizeTaskDocument(template, language, translateText) {
    requireLanguage(language);
    const doc = new DOMParser().parseFromString(template, "text/html");
    doc.documentElement.lang = language;

    for (const element of doc.querySelectorAll("[data-translate]")) {
        if (!textTargets.has(element.localName) || element.childElementCount !== 0) {
            throw new StudyAssetError(`Invalid translation target: ${element.localName}`);
        }
        const key = element.getAttribute("data-translate").trim() || element.textContent.trim();
        element.textContent = translateText(key);
    }

    for (const link of doc.querySelectorAll('link[rel~="stylesheet" i][href]')) {
        const href = link.getAttribute("href");
        if (!Object.hasOwn(stylesheetByRelativePath, href)) continue;
        const style = doc.createElement("style");
        style.textContent = stylesheetByRelativePath[href];
        link.replaceWith(style);
    }

    for (const element of doc.querySelectorAll("[src], [href]")) {
        for (const attribute of ["src", "href"]) {
            const path = element.getAttribute(attribute);
            if (Object.hasOwn(iconUrlByRelativePath, path)) element.setAttribute(attribute, iconUrlByRelativePath[path]);
        }
    }

    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function resolveTaskAsset(test, assetName, language, translateText) {
    if (test === "listening-speaking-test" && assetName === "listener.png") {
        return { type: "image", srcImg: resolveLocalizedImage(test, assetName, language) };
    }

    const template = getExactAsset(taskDocuments, `../assets/html/${test}/${assetName}`);
    return { type: "html", srcDoc: localizeTaskDocument(template, language, translateText) };
}

function loadStudyAsset(resolve) {
    try {
        return resolve();
    } catch (error) {
        if (!(error instanceof StudyAssetError)) throw error;
        console.error(error.message);
        return null;
    }
}

export { loadStudyAsset, localizeTaskDocument, resolveLocalizedImage, resolveTaskAsset };
