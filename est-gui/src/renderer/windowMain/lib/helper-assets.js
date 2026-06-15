import listeningSpeakingTestCss from "@/assets/css/listening-speaking-test.css?raw";
import shortConversationTestCss from "@/assets/css/short-conversation-test.css?raw";
import firaCodeFontUrl from "@/assets/fonts/FiraCode.ttf?url";
import interFontUrl from "@/assets/fonts/Inter.ttf?url";

const conditionSctHtmlAssets = import.meta.glob("@/assets/html/short-conversation-test/**/*.html", { eager: true, query: "?raw", import: "default" });
const conditionSctImageAssets = import.meta.glob("@/assets/img/short-conversation-test/**/*.png", { eager: true, query: "?url", import: "default" });
const conditionLstHtmlAssets = import.meta.glob("@/assets/html/listening-speaking-test/**/*.html", { eager: true, query: "?raw", import: "default" });
const conditionLstImageAssets = import.meta.glob("@/assets/img/listening-speaking-test/**/*.png", { eager: true, query: "?url", import: "default" });

/* -------------- CSS Rewrites -------------- */

const cssContentRewriteUrls = (css) =>
    css.replace(/url\(["']?([^"')]+)["']?\)/g, (match, fontPath) => {
        const fontUrl = fontUrlByRelativePath[fontPath];
        return fontUrl ? `url("${fontUrl}")` : match;
    });
const cssContentEscapeStyleTags = (css) => css.replace(/<\/style/gi, "<\\/style");

const fontUrlByRelativePath = {
    "../fonts/Inter.ttf": interFontUrl,
    "../fonts/FiraCode.ttf": firaCodeFontUrl
};
const stylesheetByRelativePath = {
    "../../../css/short-conversation-test.css": cssContentEscapeStyleTags(cssContentRewriteUrls(shortConversationTestCss)),
    "../../../css/listening-speaking-test.css": cssContentEscapeStyleTags(cssContentRewriteUrls(listeningSpeakingTestCss))
};

/* -------------- HTML Rewrites -------------- */

const htmlRelativeAssetCreateUrlMap = (assets) =>
    Object.fromEntries(
        Object.entries(assets)
            .map(([key, value]) => {
                const assetPath = key.split("/assets/").at(-1);
                return assetPath ? [`../../../${assetPath}`, value] : null;
            })
            .filter(Boolean)
    );

const htmlRelativeAssetRewriteUrl = (html, assetByRelativePath) =>
    html
        .replace(/<link\b([^>]*?)\bhref="([^"]+)"([^>]*?)>/g, (match, before, href, after) => {
            const css = stylesheetByRelativePath[href];
            if (!css || !/\brel="stylesheet"/.test(`${before}${after}`)) return match;

            return `<style>${css}</style>`;
        })
        .replace(/\b(src|href)="([^"]+)"/g, (match, attribute, assetPath) => {
            const asset = assetByRelativePath[assetPath];
            return asset ? `${attribute}="${asset}"` : match;
        });

/* -------------- Asset Factories -------------- */

const createHtmlAssets = (htmlAssets, assetByRelativePath) => Object.fromEntries(Object.entries(htmlAssets).map(([key, html]) => [key, { srcDoc: htmlRelativeAssetRewriteUrl(html, assetByRelativePath), type: "html" }]));
const createImageAssets = (imageAssets) => Object.fromEntries(Object.entries(imageAssets).map(([key, srcImg]) => [key, { srcImg, type: "image" }]));

/* -------------- Asset Collections -------------- */

const conditionSctAssets = {
    ...createHtmlAssets(conditionSctHtmlAssets, htmlRelativeAssetCreateUrlMap(conditionSctImageAssets)),
    ...createImageAssets(conditionSctImageAssets)
};
const conditionSctExplanationAssets = createImageAssets(import.meta.glob("@/assets/img/short-conversation-test/*.png", { eager: true, query: "?url", import: "default" }));

const conditionLstAssets = {
    ...createHtmlAssets(conditionLstHtmlAssets, htmlRelativeAssetCreateUrlMap(conditionLstImageAssets)),
    ...createImageAssets(conditionLstImageAssets)
};
const conditionLstExplanationAssets = createImageAssets(import.meta.glob("@/assets/img/listening-speaking-test/*.png", { eager: true, query: "?url", import: "default" }));

/* -------------- Asset Resolver -------------- */

const resolveAsset = (assets, assetName) => {
    if (!assetName) return null;
    let key = Object.keys(assets).find((k) => k.endsWith(assetName));

    if (!key && assetName.endsWith(".png")) {
        const htmlName = assetName.replace(".png", ".html");
        key = Object.keys(assets).find((k) => k.endsWith(htmlName));
    }

    if (!key) return null;

    return assets[key];
};

/* -------------- Exports -------------- */

export { conditionLstAssets, conditionLstExplanationAssets, conditionSctAssets, conditionSctExplanationAssets, resolveAsset };
