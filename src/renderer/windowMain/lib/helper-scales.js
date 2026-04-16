const scaleOrder = ["audio_quality", "noisiness", "discontinuity", "coloration", "loudness", "echo", "degradation", "interaction"];

const listeningSpeakingTestScaleGroups = {
    listener: ["noisiness", "discontinuity", "coloration", "loudness"],
    speaker: ["echo", "degradation"]
};

const scaleDetails = {
    audio_quality: {
        displayName: "Audio Quality",
        description: 'The term "Audio Quality" means that you rate the overall quality of the call as a whole.'
    },
    noisiness: {
        displayName: "Noisiness",
        description: 'The term "Noisiness" means that you evaluate the noisiness of what you heard. The terms "not noisy" and "noisy" can be described with the terms "noiseless" and "not hissing" vs. "noisy" and "hissing", respectively.'
    },
    discontinuity: {
        displayName: "Discontinuity",
        description: 'The term "Discontinuity" means that you evaluate the continuity of what you heard. The terms "continuous" and "discontinuous" can be described with the terms "even" and "not chopped" vs. "uneven" and "chopped", respectively.'
    },
    coloration: {
        displayName: "Coloration",
        description: 'The term "Coloration" means that you evaluate the coloration of what you heard. The terms "uncolored" and "colored" can be described with the terms "direct" and "full" vs. "indirect" and "thin", respectively.'
    },
    loudness: {
        displayName: "Loudness",
        description: 'The term "Loudness" means that you evaluate whether the volume of what you heard is optimal. The terms "optimal" and "not optimal" can be described with the terms "not too loud" and "not too quiet" vs. "too loud" and "too quiet", respectively.'
    },
    echo: {
        displayName: "Echo",
        description: 'The term "Echo" means that you evaluate the impact of your own voice being played back to you. The terms "not disturbing" and "disturbing" can be described with the terms "not distracting" and "not irritating" vs. "distracting" and "irritating", respectively.'
    },
    degradation: {
        displayName: "Degradation",
        description: 'The term "Degradation" means that you evaluate the degradation of your own voice as heard during the call. The terms "own voice not degraded" and "own voice degraded" can be described with the terms "not distorted" and "echofree" vs. "distorted" and "echoed", respectively.'
    },
    interaction: {
        displayName: "Interaction",
        description: 'The term "Interaction" means that you evaluate the ease of interaction between you and your conversational partner. The terms "easy to interact" and "hard to interact" can be described with the terms "effective" and "pleasant" vs. "ineffective" and "unpleasant", respectively.'
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

const getListeningSpeakingTestScaleOrder = (offset, participantRole) => {
    const roleScales = new Set(listeningSpeakingTestScaleGroups[participantRole] ?? []);
    return [scaleOrder[0], ...getPermutedDimensionScaleOrder(offset).filter((scaleName) => roleScales.has(scaleName))];
};

export { scaleOrder, scaleDetails, getPermutedScaleOrder, getListeningSpeakingTestScaleOrder };
