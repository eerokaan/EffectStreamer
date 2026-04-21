const conditionSctImages = import.meta.glob("@/assets/img/condition-short-conversation-test/**/*.png", { eager: true, import: "default" });
const conditionSctExplanationImages = import.meta.glob("@/assets/img/condition-short-conversation-test/*.png", { eager: true, import: "default" });
const conditionLstImages = import.meta.glob("@/assets/img/condition-listening-speaking-test/**/*.png", { eager: true, import: "default" });
const conditionLstExplanationImages = import.meta.glob("@/assets/img/condition-listening-speaking-test/*.png", { eager: true, import: "default" });

const resolveImage = (images, imageName) => {
    if (!imageName) return null;
    if (images[imageName]) return images[imageName];

    const key = Object.keys(images).find((k) => k.endsWith(imageName));
    return key ? images[key] : null;
};

export { conditionLstExplanationImages, conditionLstImages, conditionSctExplanationImages, conditionSctImages, resolveImage };
