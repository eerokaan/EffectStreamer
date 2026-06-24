function normalizeConfig(pretestForm) {
    if (!Array.isArray(pretestForm) || pretestForm.length === 0) {
        error("pretestForm", "must be a non-empty array");
    }

    const fieldNames = new Set();

    return pretestForm.map((field, index) => {
        const fieldPath = "pretestForm[" + index + "]";
        validatePlainObject(field, fieldPath);

        const name = normalizeRequiredString(field.name, fieldPath + ".name");
        if (fieldNames.has(name)) {
            error(fieldPath + ".name", "must be unique");
        }
        fieldNames.add(name);

        const type = normalizeRequiredString(field.type, fieldPath + ".type");
        if (!["input", "select", "slider", "switch"].includes(type)) {
            error(fieldPath + ".type", "must be one of: input, select, slider, switch");
        }

        const normalizedField = {
            name,
            type,
            label: normalizeRequiredString(field.label, fieldPath + ".label"),
            required: normalizeRequired(field.required, type, fieldPath + ".required"),
            layoutWidth: normalizeLayoutWidth(field, fieldPath)
        };

        const description = normalizeOptionalString(field.description, fieldPath + ".description");
        if (description) normalizedField.description = description;

        const placeholder = normalizeOptionalString(field.placeholder, fieldPath + ".placeholder");
        if (placeholder) normalizedField.placeholder = placeholder;

        if (type === "input") {
            return normalizeInputField(field, normalizedField, fieldPath);
        }
        else if (type === "select") {
            return normalizeSelectField(field, normalizedField, fieldPath);
        }
        else if (type === "slider") {
            return normalizeSliderField(field, normalizedField, fieldPath);
        }
        else if (type === "switch") {
            return normalizeSwitchField(field, normalizedField, fieldPath);
        }
    });
}

function normalizeLayoutWidth(field, fieldPath) {
    if (field.layout !== undefined) {
        error(fieldPath + ".layout", "is no longer supported; use layoutWidth instead");
    }

    const layoutWidth = field.layoutWidth ?? 12;
    if (!Number.isInteger(layoutWidth) || layoutWidth < 1 || layoutWidth > 12) {
        error(fieldPath + ".layoutWidth", "must be an integer from 1 through 12");
    }

    return layoutWidth;
}

function normalizeRequired(required, type, configPath) {
    if (required == null) {
        return type === "input" || type === "select";
    }
    if (typeof required !== "boolean") {
        error(configPath, "must be a boolean");
    }
    return required;
}

function normalizeInputField(field, normalizedField, fieldPath) {
    const inputType = field.inputType == null ? "text" : normalizeRequiredString(field.inputType, fieldPath + ".inputType");
    if (!["text", "number"].includes(inputType)) {
        error(fieldPath + ".inputType", "must be one of: text, number");
    }

    const validation = normalizeInputValidation(field.validation, inputType, fieldPath + ".validation");
    const normalizedInput = { ...normalizedField, inputType, validation };

    if (field.defaultValue !== undefined) {
        validateDefaultValue(field.defaultValue, validation, fieldPath + ".defaultValue");
        normalizedInput.defaultValue = field.defaultValue;
    }

    return normalizedInput;
}

function normalizeInputValidation(validation, inputType, configPath) {
    const normalizedValidation = normalizeValidationObject(validation, configPath);
    const valueType = normalizedValidation.valueType == null ? (inputType === "number" ? "number" : "string") : normalizeRequiredString(normalizedValidation.valueType, configPath + ".valueType");

    if (!["string", "number", "integer"].includes(valueType)) {
        error(configPath + ".valueType", "must be one of: string, number, integer");
    }

    const result = { valueType };

    if (valueType === "string") {
        if (normalizedValidation.minLength != null) result.minLength = normalizeNonNegativeInteger(normalizedValidation.minLength, configPath + ".minLength");
        if (normalizedValidation.maxLength != null) result.maxLength = normalizeNonNegativeInteger(normalizedValidation.maxLength, configPath + ".maxLength");
        if (result.minLength != null && result.maxLength != null && result.minLength > result.maxLength) {
            error(configPath, "minLength must be less than or equal to maxLength");
        }
        if (normalizedValidation.pattern != null) {
            const pattern = normalizeRequiredString(normalizedValidation.pattern, configPath + ".pattern");
            try {
                new RegExp(pattern);
            }
            catch {
                error(configPath + ".pattern", "must be a valid regular expression");
            }
            result.pattern = pattern;
        }
    }
    else {
        if (normalizedValidation.min != null) result.min = normalizeNumber(normalizedValidation.min, configPath + ".min");
        if (normalizedValidation.max != null) result.max = normalizeNumber(normalizedValidation.max, configPath + ".max");
        if (result.min != null && result.max != null && result.min > result.max) {
            error(configPath, "min must be less than or equal to max");
        }
    }

    return result;
}

function normalizeSelectField(field, normalizedField, fieldPath) {
    if (!Array.isArray(field.options) || field.options.length === 0) {
        error(fieldPath + ".options", "must be a non-empty array");
    }

    const optionValues = new Set();
    const options = field.options.map((option, index) => {
        const optionPath = fieldPath + ".options[" + index + "]";
        validatePlainObject(option, optionPath);

        const value = normalizeRequiredString(option.value, optionPath + ".value");
        if (optionValues.has(value)) {
            error(optionPath + ".value", "must be unique within this select field");
        }
        optionValues.add(value);

        return {
            value,
            label: normalizeRequiredString(option.label, optionPath + ".label")
        };
    });

    if (field.defaultValue !== undefined) {
        const defaultValue = normalizeRequiredString(field.defaultValue, fieldPath + ".defaultValue");
        if (!optionValues.has(defaultValue)) {
            error(fieldPath + ".defaultValue", "must match one of the configured option values");
        }
        return { ...normalizedField, options, defaultValue };
    }

    return { ...normalizedField, options };
}

function normalizeSliderField(field, normalizedField, fieldPath) {
    const validation = normalizeValidationObject(field.validation, fieldPath + ".validation");
    const min = validation.min == null ? 0 : normalizeNumber(validation.min, fieldPath + ".validation.min");
    const max = validation.max == null ? 100 : normalizeNumber(validation.max, fieldPath + ".validation.max");
    const step = validation.step == null ? 1 : normalizeNumber(validation.step, fieldPath + ".validation.step");

    if (min > max) {
        error(fieldPath + ".validation", "min must be less than or equal to max");
    }
    if (step <= 0) {
        error(fieldPath + ".validation.step", "must be greater than 0");
    }

    const defaultValue = field.defaultValue == null ? normalizeSliderDefaultValue(min, max, step) : normalizeNumber(field.defaultValue, fieldPath + ".defaultValue");
    if (defaultValue < min || defaultValue > max) {
        error(fieldPath + ".defaultValue", "must be within the configured slider range");
    }
    if (!normalizeSliderStepAligned(defaultValue, min, step)) {
        error(fieldPath + ".defaultValue", "must align with validation.step");
    }

    const normalizedSlider = {
        ...normalizedField,
        validation: { min, max, step },
        defaultValue
    };

    if (field.marks != null) {
        validatePlainObject(field.marks, fieldPath + ".marks");
        const minLabel = normalizeOptionalString(field.marks.minLabel, fieldPath + ".marks.minLabel");
        const maxLabel = normalizeOptionalString(field.marks.maxLabel, fieldPath + ".marks.maxLabel");
        if (minLabel || maxLabel) {
            normalizedSlider.marks = {};
            if (minLabel) normalizedSlider.marks.minLabel = minLabel;
            if (maxLabel) normalizedSlider.marks.maxLabel = maxLabel;
        }
    }

    return normalizedSlider;
}

function normalizeSwitchField(field, normalizedField, fieldPath) {
    if (field.defaultValue != null && typeof field.defaultValue !== "boolean") {
        error(fieldPath + ".defaultValue", "must be a boolean");
    }

    return { ...normalizedField, defaultValue: field.defaultValue ?? false };
}

function normalizeValidationObject(validation, configPath) {
    if (validation == null) {
        return {};
    }

    validatePlainObject(validation, configPath);
    return validation;
}

function normalizeRequiredString(value, configPath) {
    if (typeof value !== "string" || value.trim().length === 0) {
        error(configPath, "must be a non-empty string");
    }
    return value.trim();
}

function normalizeOptionalString(value, configPath) {
    if (value == null) {
        return null;
    }
    if (typeof value !== "string") {
        error(configPath, "must be a string");
    }

    const trimmedValue = value.trim();
    return trimmedValue.length > 0 ? trimmedValue : null;
}

function normalizeNumber(value, configPath) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        error(configPath, "must be a finite number");
    }
    return value;
}

function normalizeNonNegativeInteger(value, configPath) {
    if (!Number.isInteger(value) || value < 0) {
        error(configPath, "must be a non-negative integer");
    }
    return value;
}

function normalizeSliderDefaultValue(min, max, step) {
    const stepCount = Math.floor((max - min) / step);
    return min + Math.floor(stepCount / 2) * step;
}

function normalizeSliderStepAligned(value, min, step) {
    const quotient = (value - min) / step;
    return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

function validateDefaultValue(defaultValue, validation, configPath) {
    if (validation.valueType === "string" && typeof defaultValue !== "string") {
        error(configPath, "must be a string");
    }
    if (validation.valueType === "string" && validation.minLength != null && defaultValue.length < validation.minLength) {
        error(configPath, "must satisfy validation.minLength");
    }
    if (validation.valueType === "string" && validation.maxLength != null && defaultValue.length > validation.maxLength) {
        error(configPath, "must satisfy validation.maxLength");
    }
    if (validation.valueType === "string" && validation.pattern != null && !new RegExp(validation.pattern).test(defaultValue)) {
        error(configPath, "must satisfy validation.pattern");
    }
    if (validation.valueType === "number" && (typeof defaultValue !== "number" || !Number.isFinite(defaultValue))) {
        error(configPath, "must be a number");
    }
    if (validation.valueType === "integer" && !Number.isInteger(defaultValue)) {
        error(configPath, "must be an integer");
    }
    if ((validation.valueType === "number" || validation.valueType === "integer") && validation.min != null && defaultValue < validation.min) {
        error(configPath, "must satisfy validation.min");
    }
    if ((validation.valueType === "number" || validation.valueType === "integer") && validation.max != null && defaultValue > validation.max) {
        error(configPath, "must satisfy validation.max");
    }
}

function validatePlainObject(value, configPath) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
        error(configPath, "must be an object");
    }
}

function error(configPath, message) {
    throw new Error("[Config] " + configPath + " " + message);
}

module.exports = { normalizeConfig };
