const conditionSctAssets = {
    ...import.meta.glob("@/assets/html/condition-short-conversation-test/**/*.html", { eager: true, query: "?url", import: "default" }),
    ...import.meta.glob("@/assets/img/condition-short-conversation-test/**/*.png", { eager: true, import: "default" })
};
const conditionSctExplanationAssets = import.meta.glob("@/assets/img/condition-short-conversation-test/*.png", { eager: true, import: "default" });

const conditionLstAssets = {
    ...import.meta.glob("@/assets/html/condition-listening-speaking-test/**/*.html", { eager: true, query: "?url", import: "default" }),
    ...import.meta.glob("@/assets/img/condition-listening-speaking-test/**/*.png", { eager: true, import: "default" })
};
const conditionLstExplanationAssets = import.meta.glob("@/assets/img/condition-listening-speaking-test/*.png", { eager: true, import: "default" });

const resolveAsset = (assets, assetName) => {
    if (!assetName) return null;

    let key = Object.keys(assets).find((k) => k.endsWith(assetName));

    if (!key && assetName.endsWith(".png")) {
        const htmlName = assetName.replace(".png", ".html");
        key = Object.keys(assets).find((k) => k.endsWith(htmlName));
    }

    if (!key) return null;

    return {
        src: assets[key],
        type: key.endsWith(".html") ? "html" : "image"
    };
};

export { conditionLstAssets, conditionLstExplanationAssets, conditionSctAssets, conditionSctExplanationAssets, resolveAsset };
