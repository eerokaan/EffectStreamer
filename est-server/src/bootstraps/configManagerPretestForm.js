const { configError, validateObject, normalizeString, normalizeBoolean, normalizeNumeric } = require("../utils/validation.js");
const { normalizeSliderDefaultValue, normalizeSliderStepAligned } = require("../utils/slider.js");

// =======================================
// ===== Externally facing ===============
// =======================================

function normalizeConfig(pretestForm) {
    const fieldNames = new Set();

    // Validate step: Enforce pretestForm to be a non-empty array
    if (!Array.isArray(pretestForm) || pretestForm.length === 0) {
        configError("pretestForm", "must be a non-empty array");
    }

    // Return step
    return pretestForm.map((field, index) => normalizeField(field, index, fieldNames));
}

// ============================================
// ===== Internal normalization ===============
// ============================================

function normalizeField(field, index, fieldNames) {
    const fieldPath = "pretestForm[" + index + "]";
    validateObject(field, fieldPath);

    // Validate step: Enforce a unique field name
    const name = normalizeString(field.name, fieldPath + ".name");
    if (fieldNames.has(name)) {
        configError(fieldPath + ".name", "must be unique");
    }
    fieldNames.add(name);

    // Validate step: Enforce a supported field type
    const type = normalizeString(field.type, fieldPath + ".type");
    if (!["input", "select", "slider", "switch"].includes(type)) {
        configError(fieldPath + ".type", "must be one of: input, select, slider, switch");
    }

    // Normalize step: Create output object
    const normalizedField = {
        name,
        type,
        label: normalizeString(field.label, fieldPath + ".label"),
        required: normalizeBoolean(field.required, fieldPath + ".required", true, type === "input" || type === "select"),
        layoutWidth: normalizeLayoutWidth(field, fieldPath)
    };

    // Normalize step: Add optional field text
    const description = normalizeString(field.description, fieldPath + ".description", true, null);
    if (description) normalizedField.description = description;

    const placeholder = normalizeString(field.placeholder, fieldPath + ".placeholder", true, null);
    if (placeholder) normalizedField.placeholder = placeholder;

    // Return step
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
}

function normalizeLayoutWidth(field, fieldPath) {
    const layoutWidth = field.layoutWidth ?? 12;

    // Validate step: Enforce a valid layout width
    if (!Number.isInteger(layoutWidth) || layoutWidth < 1 || layoutWidth > 12) {
        configError(fieldPath + ".layoutWidth", "must be an integer from 1 through 12");
    }

    // Return step
    return layoutWidth;
}

function normalizeInputField(field, normalizedField, fieldPath) {
    const inputType = field.inputType == null ? "text" : normalizeString(field.inputType, fieldPath + ".inputType");

    // Validate step: Enforce a supported input type
    if (!["text", "number"].includes(inputType)) {
        configError(fieldPath + ".inputType", "must be one of: text, number");
    }

    // Normalize step: Create output object
    const validation = normalizeInputValidation(field.validation, inputType, fieldPath + ".validation");
    const normalizedInput = { ...normalizedField, inputType, validation };

    // Validate step: Enforce a valid default value
    if (field.defaultValue !== undefined) {
        validateDefaultValue(field.defaultValue, validation, fieldPath + ".defaultValue");
        normalizedInput.defaultValue = field.defaultValue;
    }

    // Return step
    return normalizedInput;
}

function normalizeInputValidation(validation, inputType, configPath) {
    const normalizedValidation = normalizeValidation(validation, configPath);
    let valueType = null;

    // Normalize step: Determine the validation value type
    if (normalizedValidation.valueType == null) valueType = inputType === "number" ? "number" : "string";
    else valueType = normalizeString(normalizedValidation.valueType, configPath + ".valueType");

    if (!["string", "number", "integer"].includes(valueType)) {
        configError(configPath + ".valueType", "must be one of: string, number, integer");
    }

    // Normalize step: Create output object
    const result = { valueType };

    // Normalize step: Add type-specific validation settings (String or Numeric)
    if (valueType === "string") {
        if (normalizedValidation.minLength != null) result.minLength = normalizeNumeric(normalizedValidation.minLength, configPath + ".minLength", { integer: true, min: 0 });
        if (normalizedValidation.maxLength != null) result.maxLength = normalizeNumeric(normalizedValidation.maxLength, configPath + ".maxLength", { integer: true, min: 0 });

        if (result.minLength != null && result.maxLength != null && result.minLength > result.maxLength) {
            configError(configPath, "minLength must be less than or equal to maxLength");
        }
        if (normalizedValidation.pattern != null) {
            const pattern = normalizeString(normalizedValidation.pattern, configPath + ".pattern");

            try {
                new RegExp(pattern);
            }
            catch {
                configError(configPath + ".pattern", "must be a valid regular expression");
            }
            result.pattern = pattern;
        }
    }
    else {
        if (normalizedValidation.min != null) result.min = normalizeNumeric(normalizedValidation.min, configPath + ".min");
        if (normalizedValidation.max != null) result.max = normalizeNumeric(normalizedValidation.max, configPath + ".max");

        if (result.min != null && result.max != null && result.min > result.max) {
            configError(configPath, "min must be less than or equal to max");
        }
    }

    // Return step
    return result;
}

function normalizeSelectField(field, normalizedField, fieldPath) {
    const optionValues = new Set();

    // Validate step: Enforce a non-empty options array
    if (!Array.isArray(field.options) || field.options.length === 0) {
        configError(fieldPath + ".options", "must be a non-empty array");
    }

    // Normalize step: Determine the select options
    const options = field.options.map((option, index) => {
        const optionPath = fieldPath + ".options[" + index + "]";
        validateObject(option, optionPath);

        const value = normalizeString(option.value, optionPath + ".value");
        if (optionValues.has(value)) {
            configError(optionPath + ".value", "must be unique within this select field");
        }
        optionValues.add(value);

        return {
            value,
            label: normalizeString(option.label, optionPath + ".label")
        };
    });

    // Normalize step: Create output object
    const normalizedSelect = { ...normalizedField, options };

    // Validate step: Enforce a valid default value
    if (field.defaultValue !== undefined) {
        const defaultValue = normalizeString(field.defaultValue, fieldPath + ".defaultValue");
        if (!optionValues.has(defaultValue)) {
            configError(fieldPath + ".defaultValue", "must match one of the configured option values");
        }
        normalizedSelect.defaultValue = defaultValue;
    }

    // Return step
    return normalizedSelect;
}

function normalizeSliderField(field, normalizedField, fieldPath) {
    const validation = normalizeValidation(field.validation, fieldPath + ".validation");
    const min = validation.min == null ? 0 : normalizeNumeric(validation.min, fieldPath + ".validation.min");
    const max = validation.max == null ? 100 : normalizeNumeric(validation.max, fieldPath + ".validation.max");
    const step = validation.step == null ? 1 : normalizeNumeric(validation.step, fieldPath + ".validation.step");

    // Validate step: Enforce a valid slider range and step
    if (min > max) configError(fieldPath + ".validation", "min must be less than or equal to max");
    if (step <= 0) configError(fieldPath + ".validation.step", "must be greater than 0");

    // Normalize step: Determine the default value
    let defaultValue = null;
    if (field.defaultValue == null) defaultValue = normalizeSliderDefaultValue(min, max, step);
    else defaultValue = normalizeNumeric(field.defaultValue, fieldPath + ".defaultValue");

    // Validate step: Enforce a valid default value
    if (defaultValue < min || defaultValue > max) {
        configError(fieldPath + ".defaultValue", "must be within the configured slider range");
    }
    if (!normalizeSliderStepAligned(defaultValue, min, step)) {
        configError(fieldPath + ".defaultValue", "must align with validation.step");
    }

    // Normalize step: Create output object
    const normalizedSlider = { ...normalizedField, validation: { min, max, step }, defaultValue };

    // Normalize step: Add optional slider marks
    if (field.marks != null) {
        validateObject(field.marks, fieldPath + ".marks");
        const minLabel = normalizeString(field.marks.minLabel, fieldPath + ".marks.minLabel", true, null);
        const maxLabel = normalizeString(field.marks.maxLabel, fieldPath + ".marks.maxLabel", true, null);

        if (minLabel || maxLabel) {
            normalizedSlider.marks = {};
            if (minLabel) normalizedSlider.marks.minLabel = minLabel;
            if (maxLabel) normalizedSlider.marks.maxLabel = maxLabel;
        }
    }

    // Return step
    return normalizedSlider;
}

function normalizeSwitchField(field, normalizedField, fieldPath) {
    // Validate step: Enforce a valid default value
    if (field.defaultValue != null && typeof field.defaultValue !== "boolean") {
        configError(fieldPath + ".defaultValue", "must be a boolean");
    }

    // Normalize step: Create output object
    const normalizedSwitch = { ...normalizedField, defaultValue: field.defaultValue ?? false };

    // Return step
    return normalizedSwitch;
}

function normalizeValidation(validation, configPath) {
    if (validation == null) return {};
    validateObject(validation, configPath);
    return validation;
}

// =========================================
// ===== Internal validation ===============
// =========================================

function validateDefaultValue(defaultValue, validation, configPath) {
    if (validation.valueType === "string" && typeof defaultValue !== "string") {
        configError(configPath, "must be a string");
    }
    if (validation.valueType === "string" && validation.minLength != null && defaultValue.length < validation.minLength) {
        configError(configPath, "must satisfy validation.minLength");
    }
    if (validation.valueType === "string" && validation.maxLength != null && defaultValue.length > validation.maxLength) {
        configError(configPath, "must satisfy validation.maxLength");
    }
    if (validation.valueType === "string" && validation.pattern != null && !new RegExp(validation.pattern).test(defaultValue)) {
        configError(configPath, "must satisfy validation.pattern");
    }
    if (validation.valueType === "number" && (typeof defaultValue !== "number" || !Number.isFinite(defaultValue))) {
        configError(configPath, "must be a number");
    }
    if (validation.valueType === "integer" && !Number.isInteger(defaultValue)) {
        configError(configPath, "must be an integer");
    }
    if ((validation.valueType === "number" || validation.valueType === "integer") && validation.min != null && defaultValue < validation.min) {
        configError(configPath, "must satisfy validation.min");
    }
    if ((validation.valueType === "number" || validation.valueType === "integer") && validation.max != null && defaultValue > validation.max) {
        configError(configPath, "must satisfy validation.max");
    }
}

module.exports = { normalizeConfig };
