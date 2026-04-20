import * as z from "zod";

export const formSchema = z.object({
    "input-age": z.coerce.number({ error: "Bitte geben Sie eine gültige Zahl ein" }),
    "select-gender": z.string().min(1, "Bitte wählen Sie eine Option"),
    "select-german-proficiency": z.string().min(1, "Bitte wählen Sie eine Option"),
    "select-hours-internet": z.string().min(1, "Bitte wählen Sie eine Option"),
    "select-hours-calls": z.string().min(1, "Bitte wählen Sie eine Option"),
    "switch-gaming": z.literal(true, { error: "Dieses Feld ist erforderlich" }),
    "switch-streaming": z.literal(true, { error: "Dieses Feld ist erforderlich" }),
    "slider-experience": z.coerce.number({ error: "Dieses Feld ist erforderlich" }),
    "switch-first-time": z.literal(true, { error: "Dieses Feld ist erforderlich" }),
    "switch-audio-tech-familiarity": z.literal(true, {
        error: "Dieses Feld ist erforderlich"
    })
});
