const scaleOrder = ["audio_quality", "noisiness", "discontinuity", "coloration", "loudness", "echo", "degradation", "interaction"];

const listeningSpeakingTestScaleGroups = {
    listener: ["noisiness", "discontinuity", "coloration", "loudness"],
    speaker: ["echo", "degradation"]
};

const scaleDetails = {
    audio_quality: {
        displayName: "Audio quality",
        description: "Rate the overall audio quality of the conversation."
    },
    noisiness: {
        displayName: "Noise",
        description: "Rate how noisy the audio sounded, including any hiss you noticed."
    },
    discontinuity: {
        displayName: "Continuity",
        description: "Rate how smoothly the audio came through: was it steady and uninterrupted, or uneven and broken up?"
    },
    coloration: {
        displayName: "Coloration",
        description: "Rate how much the sound changed in character. Uncolored sound can sound direct and full; colored sound can sound indirect or thin."
    },
    loudness: {
        displayName: "Loudness",
        description: "Rate whether the audio was at a comfortable volume: neither too loud nor too quiet, or noticeably too loud or too quiet."
    },
    echo: {
        displayName: "Echo",
        description: "Rate how distracting or irritating it was to hear your own voice echoed back while you were speaking."
    },
    degradation: {
        displayName: "Own-voice impairment",
        description: "Rate how much the sound of your own voice was affected during the conversation. Did it sound clear and free of echo, or was it distorted or echoed?"
    },
    interaction: {
        displayName: "Ease of interaction",
        description: "Rate how easy it was to interact with your partner. Was the interaction effective and pleasant, or ineffective and unpleasant?"
    }
};

const getPermutedDimensionScaleOrder = (offset) => {
    const dimensionScales = scaleOrder.slice(1);
    const normalizedOffset = ((offset % dimensionScales.length) + dimensionScales.length) % dimensionScales.length;
    return [...dimensionScales.slice(normalizedOffset), ...dimensionScales.slice(0, normalizedOffset)];
};

const getPermutedScaleOrder = (offset) => {
    return [scaleOrder[0], ...getPermutedDimensionScaleOrder(offset)];
};

const getListeningSpeakingTestScaleOrder = (offset, conditionListeningSpeakingTestRole) => {
    const roleScales = new Set(listeningSpeakingTestScaleGroups[conditionListeningSpeakingTestRole] ?? []);
    return [scaleOrder[0], ...getPermutedDimensionScaleOrder(offset).filter((scaleName) => roleScales.has(scaleName))];
};

export { getListeningSpeakingTestScaleOrder, getPermutedScaleOrder, scaleDetails, scaleOrder };
