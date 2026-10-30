const { object } = require("@effectstreamer/common");
function validatePretestAnswers(fields, answers) {
    object(answers, "questionnaire answers");const result = {};
    if (Object.keys(answers).some(name => !fields.some(field => field.name === name))) throw new Error("Unknown questionnaire field");
    for (const field of fields) {
        const value = answers[field.name], rule = field.validation || {};
        if (value === undefined || value === null || value === "") {if (field.required) throw new Error("Required questionnaire answer: " + field.name);continue;}
        const invalid = () => {throw new Error("Invalid questionnaire answer: " + field.name);};
        if (field.type === "select") {if (!field.options.some(option => option.value === value)) invalid();}
        else if (field.type === "switch") {if (typeof value !== "boolean") invalid();}
        else if (field.type === "slider" || ["number", "integer"].includes(rule.valueType)) {
            if (typeof value !== "number" || !Number.isFinite(value) || (rule.valueType === "integer" && !Number.isInteger(value)) || (rule.min != null && value < rule.min) || (rule.max != null && value > rule.max)) invalid();
            if (field.type === "slider" && Math.abs((value - rule.min) / rule.step - Math.round((value - rule.min) / rule.step)) > 1e-6) invalid();
        }
        else if (typeof value !== "string" || (rule.minLength != null && value.length < rule.minLength) || (rule.maxLength != null && value.length > rule.maxLength) || (rule.pattern && !new RegExp(rule.pattern).test(value))) invalid();
        Object.defineProperty(result, field.name, { value, enumerable: true });
    }
    return result;
}
const scales = ["audio_quality", "noisiness", "discontinuity", "coloration", "loudness", "echo", "degradation", "interaction"];
function validateRating(values, { testType, role }) {
    object(values, "rating answers");
    const required = testType === "sct" ? scales : role === "speaker" ? ["audio_quality", "echo", "degradation"] : ["audio_quality", "noisiness", "discontinuity", "coloration", "loudness"];
    if (Object.keys(values).length !== required.length || required.some(key => typeof values[key] !== "number" || !Number.isFinite(values[key]) || values[key] < 0 || values[key] > 1)) throw new Error("All required rating answers must be between zero and one");
    return { ...values };
}
module.exports = { validatePretestAnswers, validateRating };
