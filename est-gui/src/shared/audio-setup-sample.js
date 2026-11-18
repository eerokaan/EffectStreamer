export function audioSetupSampleFilename(language) {
    if (language === "en") return "P501_C_english_f1_FB_48k.wav";
    if (language === "de") return "P501_C_german_f1_FB_48k.wav";
    throw new Error("Invalid study language for the audio setup sample");
}
