function normalizeSliderDefaultValue(min, max, step) {
    const stepCount = Math.floor((max - min) / step);
    return min + Math.floor(stepCount / 2) * step;
}

function normalizeSliderStepAligned(value, min, step) {
    const quotient = (value - min) / step;
    return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

module.exports = { normalizeSliderDefaultValue, normalizeSliderStepAligned };
