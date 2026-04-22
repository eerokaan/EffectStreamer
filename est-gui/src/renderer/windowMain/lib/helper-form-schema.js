import * as z from "zod";

const errorNumber = "Bitte geben Sie eine gültige Zahl ein";
const errorString = "Bitte wählen Sie eine Option";

export const formSchema = z.object({
    "input-age": z.string({ error: errorNumber }).regex(/^\d+$/, { message: errorNumber }).transform(Number),
    "select-gender": z.string({ error: errorString }).min(1, errorString),
    "select-german-proficiency": z.string({ error: errorString }).min(1, errorString),
    "select-hours-internet": z.string({ error: errorString }).min(1, errorString),
    "select-hours-calls": z.string({ error: errorString }).min(1, errorString)
});
