import { describe, expect, it } from "vitest";
import { createTranslationInstance, parseTranslationCsv } from "@/lib/helper-languages-core";
import { createParticipantRuntime } from "@/runtime/create-runtime";

describe("study localization", () => {
    it("rejects ambiguous CSV keys and mismatched interpolation variables", () => {
        expect(() => parseTranslationCsv("source,translation\nContinue,Weiter\nContinue,Fortfahren", "de.csv")).toThrow(/duplicate/);
        expect(() => parseTranslationCsv("source,translation\nHello {{name}},Hallo {{other}}", "de.csv")).toThrow(/placeholders/);
    });

    it("translates literal English phrases including punctuation", () => {
        const en = parseTranslationCsv('source,translation\n"WAV: Ready.","WAV: Ready."', "en.csv");
        const de = parseTranslationCsv('source,translation\n"WAV: Ready.","WAV: Bereit."', "de.csv");
        const i18n = createTranslationInstance({ en, de });
        expect(i18n.getFixedT("de")("WAV: Ready.")).toBe("WAV: Bereit.");
        expect(i18n.getFixedT("en")("WAV: Ready.")).toBe("WAV: Ready.");
    });

    it("publishes the server language even if subsequent admission fails", async () => {
        const config = { sessionLanguage: "de" };
        const runtime = createParticipantRuntime({ initialize: async onConfiguration => {
            onConfiguration(config);
            throw new Error("Admission failed");
        } });
        const configurations = [];
        runtime.subscribeConfiguration(value => configurations.push(value.sessionLanguage));
        await expect(runtime.bootstrap()).rejects.toThrow("Admission failed");
        expect(configurations).toEqual(["de"]);
        expect(runtime.config()).toEqual(config);
    });
});
