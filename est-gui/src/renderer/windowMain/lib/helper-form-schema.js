import * as z from "zod";

const errorBoolean = "Please make a selection.";
const errorNumber = "Please enter a valid number.";
const errorString = "Please select an option.";
const errorText = "Please fill in this field.";

function buildPretestFieldSchema(field, t) {
    if (field.type === "input") {
        return buildInputSchema(field, t);
    }
    if (field.type === "select") {
        return buildSelectSchema(field, t(errorString));
    }
    if (field.type === "slider") {
        return buildSliderSchema(field, t(errorNumber));
    }
    if (field.type === "switch") {
        return z.boolean({ error: t(errorBoolean) });
    }

    return z.never();
}

function buildInputSchema(field, t) {
    const validation = field.validation ?? {};

    if (validation.valueType === "number" || validation.valueType === "integer") {
        return buildNumericInputSchema(field, t(errorNumber));
    }

    return buildStringInputSchema(field, t(errorText));
}

function buildNumericInputSchema(field, errorNumber) {
    const validation = field.validation ?? {};
    let schema = z.number({ error: errorNumber });

    if (validation.valueType === "integer") {
        schema = schema.refine((value) => Number.isInteger(value), { message: errorNumber });
    }
    if (validation.min != null) {
        schema = schema.min(validation.min, { message: errorNumber });
    }
    if (validation.max != null) {
        schema = schema.max(validation.max, { message: errorNumber });
    }

    if (!field.required) {
        schema = schema.optional();
    }

    return z.preprocess((value) => {
        if (value == null || value === "") {
            return undefined;
        }
        if (typeof value === "number") {
            return value;
        }
        return Number(value);
    }, schema);
}

function buildStringInputSchema(field, errorText) {
    const validation = field.validation ?? {};
    let schema = z.string({ error: errorText });

    if (field.required) {
        schema = schema.min(1, { message: errorText });
    }
    if (validation.minLength != null) {
        schema = schema.min(validation.minLength, { message: errorText });
    }
    if (validation.maxLength != null) {
        schema = schema.max(validation.maxLength, { message: errorText });
    }
    if (validation.pattern) {
        schema = schema.regex(new RegExp(validation.pattern), { message: errorText });
    }
    if (!field.required) {
        schema = z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
    }

    return schema;
}

function buildSelectSchema(field, errorString) {
    const optionValues = new Set(field.options.map((option) => option.value));
    let schema = z.string({ error: errorString }).refine((value) => optionValues.has(value), { message: errorString });

    if (!field.required) {
        schema = z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
    }

    return schema;
}

function buildSliderSchema(field, errorNumber) {
    const validation = field.validation ?? {};
    const min = validation.min ?? 0;
    const max = validation.max ?? 100;
    const step = validation.step ?? 1;

    return z
        .number({ error: errorNumber })
        .min(min, { message: errorNumber })
        .max(max, { message: errorNumber })
        .refine((value) => isStepAligned(value, min, step), { message: errorNumber });
}

function isStepAligned(value, min, step) {
    const quotient = (value - min) / step;
    return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

function buildPretestFormSchema(pretestForm, translate) {
    const formShape = {};

    for (const field of pretestForm) {
        formShape[field.name] = buildPretestFieldSchema(field, translate);
    }

    return z.object(formShape);
}

export { buildPretestFormSchema };
