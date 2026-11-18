import { expect, it } from "vitest";
import { audioSetupSampleFilename } from "../../est-gui/src/shared/audio-setup-sample.js";

it("maps the coordinator language to only the matching bundled P.501 file", () => {
    expect(audioSetupSampleFilename("en")).toBe("P501_C_english_f1_FB_48k.wav");
    expect(audioSetupSampleFilename("de")).toBe("P501_C_german_f1_FB_48k.wav");
    for (const bad of [undefined, "fr", "EN", "../en", "constructor"]) {
        expect(() => audioSetupSampleFilename(bad)).toThrow(/study language/);
    }
});
