const scaleOrder = ["audio_quality", "noisiness", "discontinuity", "coloration", "loudness", "echo", "degradation", "interaction"];

const scaleDetails = {
    audio_quality: {
        displayName: "Audio Quality",
        description: "Please rate the overall quality of the sound you heard during the telephone call in this condition."
    },
    noisiness: {
        displayName: "Noisiness",
        description: 'With this scale, you are to evaluate the noisiness of what you heard in a condition. The terms "not noisy" and "noisy" can be described with the terms noiseless and not hissing and noisy and hissing, respectively.'
    },
    discontinuity: {
        displayName: "Discontinuity",
        description: 'The term "continuous" means that what you heard in a condition is completely even, firm, not chopped and not frayed. The term "discontinuous" can be described with terms like uneven, wobbly, chopped or frayed.'
    },
    coloration: {
        displayName: "Coloration",
        description: 'The term "uncolored" means that what you heard in a condition is direct, close, full and not nasally. The term "colored" means the heard sound is indirect, far, thin and nasally.'
    },
    loudness: {
        displayName: "Loudness",
        description: "If the heard sound is neither too loud nor too quiet then the volume is optimal. If that is not the case then the volume is not optimal."
    },
    echo: {
        displayName: "Echo",
        description:
            "In some conditions, you will be confronted with back-coupling of your own voice. This means that you will hear your own voice. With this characteristic you are to evaluate if this does or doesn't negatively impact your speaking. More to the point, you are to evaluate if speaking while hearing yourself is not distracting, not irritating, fluid and does not take concentration or if it is distracting, irritating, not fluid and takes concentration."
    },
    degradation: {
        displayName: "Degradation",
        description: 'The term "own voice not degraded" means that you hear your own voice unaltered, e.g., you hear your voice not distorted, echofree and with optimal volume. The term "own voice degraded" can be described with terms like distorted, echoed, thin or not optimal volume.'
    },
    interaction: {
        displayName: "Interaction",
        description: 'The term "easy to interact" means that the interaction between you and your conversational partner is easy. That means you have an effective, pleasant, easy, and agile interaction. The term "hard to interact" means that the interaction is ineffective, unpleasant, hard and sluggish.'
    }
};

export { scaleOrder, scaleDetails };
