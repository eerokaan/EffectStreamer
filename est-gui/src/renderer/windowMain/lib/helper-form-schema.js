import * as z from "zod";

const errorBoolean = "Bitte treffen Sie eine Auswahl";
const errorNumber = "Bitte geben Sie eine gültige Zahl ein";
const errorString = "Bitte wählen Sie eine Option";
const errorText = "Bitte füllen Sie dieses Feld aus";

function buildPretestFieldSchema(field) {
    if (field.type === "input") {
        return buildInputSchema(field);
    }
    if (field.type === "select") {
        return buildSelectSchema(field);
    }
    if (field.type === "slider") {
        return buildSliderSchema(field);
    }
    if (field.type === "switch") {
        return z.boolean({ error: errorBoolean });
    }

    return z.never();
}

function buildInputSchema(field) {
    const validation = field.validation ?? {};

    if (validation.valueType === "number" || validation.valueType === "integer") {
        return buildNumericInputSchema(field);
    }

    return buildStringInputSchema(field);
}

function buildNumericInputSchema(field) {
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

function buildStringInputSchema(field) {
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

function buildSelectSchema(field) {
    const optionValues = new Set(field.options.map((option) => option.value));
    let schema = z.string({ error: errorString }).refine((value) => optionValues.has(value), { message: errorString });

    if (!field.required) {
        schema = z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
    }

    return schema;
}

function buildSliderSchema(field) {
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

function buildPretestFormSchema(pretestForm = []) {
    const formShape = {};

    for (const field of pretestForm) {
        formShape[field.name] = buildPretestFieldSchema(field);
    }

    return z.object(formShape);
}

export { buildPretestFormSchema };
