import { useTranslation } from "react-i18next";
import { createTranslationInstance, parseTranslationCsv } from "@/lib/helper-languages-core";
import useStoreRoot from "@/stores/root";
import deCsv from "@/assets/languages/de.csv?raw";
import enCsv from "@/assets/languages/en.csv?raw";

const catalogs = { en: parseTranslationCsv(enCsv, "en.csv"), de: parseTranslationCsv(deCsv, "de.csv") };
const i18n = createTranslationInstance(catalogs);

export function useSessionLanguage() {
    return useStoreRoot((state) => state.sessionLanguage);
}

export function useTranslate() {
    const language = useSessionLanguage();
    return useTranslation("translation", { i18n, lng: language, useSuspense: false }).t;
}

export function translate(language, key, options) {
    return i18n.getFixedT(language)(key, options);
}

export function translateConfiguredText(key, t) {
    return Object.hasOwn(catalogs.en, key) ? t(key) : key;
}
