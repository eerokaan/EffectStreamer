const scaleOrder = ["audio_quality", "noisiness", "discontinuity", "coloration", "loudness", "echo", "degradation", "interaction"];

const listeningSpeakingTestScaleGroups = {
    listener: ["noisiness", "discontinuity", "coloration", "loudness"],
    speaker: ["echo", "degradation"]
};

const scaleDetails = {
    audio_quality: {
        displayName: "Audioqualität",
        description: 'Der Begriff "Audioqualität" bedeutet, dass Sie die Gesamtqualität des Gesprächs als Ganzes bewerten.'
    },
    noisiness: {
        displayName: "Rauschen",
        description: 'Der Begriff "Rauschen" bedeutet, dass Sie das Rauschen des Gehörten bewerten. Die Begriffe "nicht verrauscht" und "verrauscht" können mit den Begriffen "rauschfrei" und "nicht zischend" bzw. "verrauscht" und "zischend" beschrieben werden.'
    },
    discontinuity: {
        displayName: "Diskontinuität",
        description: 'Der Begriff "Diskontinuität" bedeutet, dass Sie die Kontinuität des Gehörten bewerten. Die Begriffe "kontinuierlich" und "diskontinuierlich" können mit den Begriffen "gleichmäßig" und "nicht abgehackt" bzw. "ungleichmäßig" und "abgehackt" beschrieben werden.'
    },
    coloration: {
        displayName: "Verfärbung",
        description: 'Der Begriff "Verfärbung" bedeutet, dass Sie die klangliche Verfärbung des Gehörten bewerten. Die Begriffe "unverfärbt" und "verfärbt" können mit den Begriffen "direkt" und "voll" bzw. "indirekt" und "dünn" beschrieben werden.'
    },
    loudness: {
        displayName: "Lautstärke",
        description: 'Der Begriff "Lautstärke" bedeutet, dass Sie bewerten, ob die Lautstärke des Gehörten optimal ist. Die Begriffe "optimal" und "nicht optimal" können mit den Begriffen "nicht zu laut" und "nicht zu leise" bzw. "zu laut" und "zu leise" beschrieben werden.'
    },
    echo: {
        displayName: "Echo",
        description: 'Der Begriff "Echo" bedeutet, dass Sie die Auswirkung der Rückkopplung Ihrer eigenen Stimme bewerten. Die Begriffe "nicht störend" und "störend" können mit den Begriffen "nicht ablenkend" und "nicht irritierend" bzw. "ablenkend" und "irritierend" beschrieben werden.'
    },
    degradation: {
        displayName: "Beeinträchtigung",
        description: 'Der Begriff "Beeinträchtigung" bedeutet, dass Sie die Beeinträchtigung Ihrer eigenen Stimme während des Gesprächs bewerten. Die Begriffe "eigene Stimme nicht beeinträchtigt" und "eigene Stimme beeinträchtigt" können mit den Begriffen "nicht verzerrt" und "echofrei" bzw. "verzerrt" und "mit Echo" beschrieben werden.'
    },
    interaction: {
        displayName: "Interaktion",
        description: 'Der Begriff "Interaktion" bedeutet, dass Sie bewerten, wie leicht die Interaktion zwischen Ihnen und Ihrem Gesprächspartner ist. Die Begriffe "leichte Interaktion" und "schwere Interaktion" können mit den Begriffen "effektiv" und "angenehm" bzw. "ineffektiv" und "unangenehm" beschrieben werden.'
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
