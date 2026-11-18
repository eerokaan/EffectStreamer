import { chromium } from "@playwright/test";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "./tools.mjs";

// Browser binaries are installed separately from the GUI unit test packages.
const hasChromium = existsSync(chromium.executablePath());
const browserTest = it.skipIf(!hasChromium);
const gui = fileURLToPath(new URL("../../est-gui/", import.meta.url));
const renderer = `${gui}src/renderer/windowMain`;
const origin = "https://effectstreamer.test";
const imageFixture = {
    en: '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="8"><path fill="blue" d="M0 0h17v8H0z"/></svg>',
    de: '<svg xmlns="http://www.w3.org/2000/svg" width="23" height="8"><path fill="red" d="M0 0h23v8H0z"/></svg>'
};
const virtualModules = {
    "task-assets-test": `
        import * as assets from '@/lib/helper-assets';
        import { createElement } from 'react';
        import { createRoot } from 'react-dom/client';
        import useStoreRoot from '@/stores/root';
        import useStoreComponentScale from '@/stores/component-scale';
        import Scale from '@/components/scale.jsx';
        import SctMain from '@/views/short-conversation-test-main.jsx';
        import SctExplanation from '@/views/short-conversation-test-explanation.jsx';
        import LstMain from '@/views/listening-speaking-test-main.jsx';
        import LstExplanation from '@/views/listening-speaking-test-explanation.jsx';
        import { createTranslationInstance, parseTranslationCsv } from '@/lib/helper-languages-core';
        import enCsv from '@/assets/languages/en.csv?raw';
        import deCsv from '@/assets/languages/de.csv?raw';
        const catalogs = { en: parseTranslationCsv(enCsv, 'en.csv'), de: parseTranslationCsv(deCsv, 'de.csv') };
        const i18n = createTranslationInstance(catalogs);
        const views = { Scale, SctMain, SctExplanation, LstMain, LstExplanation };
        const root = createRoot(document.querySelector('main'));
        globalThis.subject = {
            ...assets,
            catalogs,
            translate: (language, key) => i18n.getFixedT(language)(key),
            render(view, language, props = {}, state = {}) {
                useStoreRoot.setState({ sessionLanguage: language, ...state });
                root.render(createElement(views[view], props));
            },
            scaleValues: () => useStoreComponentScale.getState().scaleValues
        };`,
    "task-assets-test-language": `
        import useStoreRoot from '@/stores/root';
        export const translate = (language, key) => language === 'de' ? 'DE: ' + key : key;
        export const useSessionLanguage = () => useStoreRoot(state => state.sessionLanguage);
        export const useTranslate = () => {
            const language = useSessionLanguage();
            return (key) => translate(language, key);
        };`,
    // The test does not dispatch footer actions to the deployment runtime.
    "task-assets-test-runtime": "export const useRuntime = () => ({});"
};

let browser;
let page;
let output;

beforeAll(async () => {
    if (!hasChromium) return;
    ({ output } = await build({
        configFile: false,
        root: gui,
        publicDir: false,
        base: "./",
        logLevel: "silent",
        esbuild: { jsx: "automatic" },
        resolve: { alias: [
            { find: /^@\/lib\/helper-languages$/, replacement: "task-assets-test-language" },
            { find: /^@\/runtime\/context$/, replacement: "task-assets-test-runtime" },
            { find: "@", replacement: renderer }
        ] },
        plugins: [{
            name: "task-assets-test",
            enforce: "pre",
            resolveId(id) {
                if (Object.hasOwn(virtualModules, id)) return `\0${id}`;
            },
            load(id) {
                if (id.startsWith("\0")) return virtualModules[id.slice(1)];
                // Distinct assets catch the wrong directory even when the trial PNGs are identical.
                const fixture = id.match(/\/img\/short-conversation-test\/(en|de)\/explanation\.png\?url$/);
                if (fixture) return `export default ${JSON.stringify(`data:image/svg+xml,${encodeURIComponent(imageFixture[fixture[1]])}`)}`;
            }
        }],
        build: {
            write: false,
            minify: false,
            assetsInlineLimit: 0,
            rollupOptions: { input: "task-assets-test" }
        }
    }));
    // Native integration runs can set SDK library paths; Chromium uses host libraries.
    const { LD_LIBRARY_PATH, GST_PLUGIN_SYSTEM_PATH, GST_PLUGIN_PATH, ...env } = process.env;
    browser = await chromium.launch({ env });
}, 120000);

beforeEach(async () => {
    await page?.close();
    page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const entry = output.find(file => file.isEntry);
    await page.route(`${origin}/**`, async route => {
        const path = new URL(route.request().url()).pathname.slice(1);
        if (path === "") {
            return route.fulfill({ contentType: "text/html", body: `<!doctype html><main></main><script type="module" src="./${entry.fileName}"></script>` });
        }
        const file = output.find(item => item.fileName === path);
        if (!file) return route.fulfill({ status: 404 });
        const contentType = path.endsWith(".js") ? "text/javascript" : path.endsWith(".ttf") ? "font/ttf" : "image/png";
        await route.fulfill({ contentType, body: file.code ?? Buffer.from(file.source) });
    });
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(globalThis.subject));
});

afterAll(async () => {
    await browser?.close();
});

browserTest("requires exact role and extension for task documents", async () => {
    const results = await page.evaluate(() => {
        const get = (test, path) => subject.resolveTaskAsset(test, path, "en", key => key);
        const a = get("short-conversation-test", "client-a/01.html");
        const b = get("short-conversation-test", "client-b/01.html");
        return {
            distinct: a.srcDoc !== b.srcDoc,
            types: [a.type, b.type, get("listening-speaking-test", "client-b/01.html").type],
            rejected: ["01.html", "ient-a/01.html", "client-a/01.png", "client-c/01.html", "client-a/../client-b/01.html", "client-b/99.html"].map(path => {
                try {
                    get("short-conversation-test", path);
                    return false;
                } catch (error) {
                    return error.message.includes(path);
                }
            })
        };
    });
    expect(results).toEqual({ distinct: true, types: ["html", "html", "html"], rejected: [true, true, true, true, true, true] });
});

browserTest("renders all 54 study pages with real catalogs in both languages", async () => {
    const outcome = await page.evaluate(() => {
        const problems = [];
        let pages = 0;
        for (const [test, count] of [["short-conversation-test", 14], ["listening-speaking-test", 13]]) {
            for (const role of ["a", "b"]) for (let index = 1; index <= count; ++index) {
                const name = `client-${role}/${String(index).padStart(2, "0")}.html`;
                function render(language, translate) {
                    const { srcDoc } = subject.resolveTaskAsset(test, name, language, translate);
                    return new DOMParser().parseFromString(srcDoc, "text/html");
                }
                const source = render("en", key => key);
                const targets = [...source.querySelectorAll("[data-translate]")];
                if (targets.length === 0) problems.push(`${name}: no translated text`);
                for (const language of ["en", "de"]) {
                    const doc = render(language, key => {
                        if (!subject.catalogs[language][key]) problems.push(`${test}/${name}: missing ${language} ${key}`);
                        return subject.translate(language, key);
                    });
                    if (doc.documentElement.lang !== language || doc.querySelectorAll("input").length !== source.querySelectorAll("input").length) {
                        problems.push(`${test}/${name}: changed structure or wrong language`);
                    }
                }
                pages++;
            }
        }
        return { pages, problems, enKeys: Object.keys(subject.catalogs.en).sort(), deKeys: Object.keys(subject.catalogs.de).sort() };
    });
    expect(outcome.pages).toBe(54);
    expect(outcome.problems).toEqual([]);
    expect(outcome.enKeys).toEqual(outcome.deKeys);
});

browserTest("keeps library availability aligned with each book at both card widths", async () => {
    const rows = await page.evaluate(async () => {
        const result = {};
        for (const language of ["en", "de"]) {
            result[language] = {};
            for (const width of [768, 1024]) {
                const frame = document.createElement("iframe");
                frame.width = width;
                frame.srcdoc = subject.resolveTaskAsset("short-conversation-test", "client-b/11.html", language, key => subject.translate(language, key)).srcDoc;
                await new Promise(resolve => {
                    frame.addEventListener("load", resolve, { once: true });
                    document.body.append(frame);
                });
                const doc = frame.contentDocument;
                await doc.fonts.ready;
                const titles = language === "en" ? ["Momo", "The Neverending Story"] : ["Momo", "Die unendliche Geschichte"];
                result[language][width] = titles.map(title => {
                    const cells = [...doc.querySelectorAll(".data-table tbody td")];
                    const titleCell = cells.find(cell => cell.textContent.trim() === title);
                    if (!titleCell) return null;
                    const availability = titleCell.nextElementSibling;
                    const loanPeriod = availability.nextElementSibling;
                    return [availability.textContent.trim(), loanPeriod.textContent.trim(), availability.getBoundingClientRect().y === titleCell.getBoundingClientRect().y];
                });
                frame.remove();
            }
        }
        return result;
    });
    const en = [["Available", "12 days", true], ["Next Friday", "12 days", true]];
    const de = [["Erhältlich", "12 Tage", true], ["Freitag", "12 Tage", true]];
    expect(rows).toEqual({ en: { 768: en, 1024: en }, de: { 768: de, 1024: de } });
});

browserTest("localizes marked text as text and preserves nearby tables, controls and breaks", async () => {
    const result = await page.evaluate(() => {
        const keys = [];
        const template = `<!doctype html><html lang="de"><head><title data-translate> Test title </title></head><body>
            <table><tbody><tr><td><input name="done" type="checkbox" checked>
            <span data-translate> Apfel &amp; Birne </span><br><span data-translate="Next text">Source text</span>
            <i>Unmarked</i></td></tr></tbody></table></body></html>`;
        const srcDoc = subject.localizeTaskDocument(template, "en", key => {
            keys.push(key);
            return { "Test title": "Card title", "Apfel & Birne": 'Apple & <em>pear</em> "today"', "Next text": "Next line" }[key];
        });
        const doc = new DOMParser().parseFromString(srcDoc, "text/html");
        return {
            lang: doc.documentElement.lang,
            doctype: doc.doctype?.name,
            title: doc.title,
            keys,
            spans: [...doc.querySelectorAll("td span")].map(el => el.textContent.trim()),
            controls: [...doc.querySelectorAll("table input")].map(el => [el.type, el.name, el.checked]),
            breaks: doc.querySelectorAll("td br").length,
            unmarked: doc.querySelector("td i").textContent,
            emElements: doc.querySelectorAll("em").length
        };
    });
    expect(result).toEqual({
        lang: "en", doctype: "html", title: "Card title", keys: ["Test title", "Apfel & Birne", "Next text"],
        spans: ['Apple & <em>pear</em> "today"', "Next line"], controls: [["checkbox", "done", true]], breaks: 1, unmarked: "Unmarked", emElements: 0
    });
});

browserTest("rejects translation markers that would replace controls or raw-text content", async () => {
    const failures = await page.evaluate(() => [
        '<style data-translate>key</style>',
        '<div data-translate>label<input type="checkbox"></div>'
    ].map(template => {
        try { subject.localizeTaskDocument(template, 'en', () => 'text'); return false; }
        catch (error) { return error.message.includes('translation target'); }
    }));
    expect(failures).toEqual([true, true]);
});

browserTest("loads shared icons and embedded styles and fonts inside a task iframe", async () => {
    await page.evaluate(() => {
        const iframe = document.createElement("iframe");
        iframe.srcdoc = subject.resolveTaskAsset("short-conversation-test", "client-a/01.html", "de", key => key).srcDoc;
        document.body.append(iframe);
    });
    const result = await page.locator("iframe").evaluate(async frame => {
        if (frame.contentDocument.readyState !== "complete" || !frame.contentDocument.querySelector("img")) {
            await new Promise(resolve => frame.addEventListener("load", resolve, { once: true }));
        }
        const doc = frame.contentDocument;
        await doc.fonts.load("16px Inter");
        return {
            lang: doc.documentElement.lang,
            icons: [...doc.images].every(img => img.complete && img.naturalWidth > 0),
            conditions: [...doc.images].some(img => img.src.includes("icon-conditions")),
            bodyFont: frame.contentWindow.getComputedStyle(doc.body).fontFamily,
            loadedInter: [...doc.fonts].some(font => font.family === "Inter" && font.status === "loaded")
        };
    });
    expect(result).toEqual({ lang: "de", icons: true, conditions: true, bodyFont: "Inter, ui-sans-serif, system-ui, sans-serif", loadedInter: true });
});

browserTest("resolves all 11 image entries in each language and does not fall back to another path", async () => {
    const result = await page.evaluate(async () => {
        const entries = {
            "short-conversation-test": ["explanation.png"],
            "listening-speaking-test": ["explanation.png", "listener.png"],
            scales: ["01_audio_quality.png", "02_coloration.png", "03_discontinuity.png", "04_degradation.png", "05_echo.png", "06_interaction.png", "07_loudness.png", "08_noisiness.png"]
        };
        const sources = ["en", "de"].flatMap(language => Object.entries(entries).flatMap(([group, names]) => names.map(name => subject.resolveLocalizedImage(group, name, language))));
        const widths = await Promise.all(sources.map(async src => {
            const img = new Image();
            img.src = src;
            await img.decode();
            return img.naturalWidth;
        }));
        const rejects = (fn) => {
            try { fn(); return false; } catch { return true; }
        };
        return {
            allLoad: widths.length === 22 && widths.every(width => width > 0),
            fixtureWidths: [widths[0], widths[11]],
            listener: subject.resolveTaskAsset("listening-speaking-test", "listener.png", "en", key => key).type,
            invalidLanguage: rejects(() => subject.resolveLocalizedImage("listening-speaking-test", "listener.png", "fr")),
            wrongGroup: rejects(() => subject.resolveLocalizedImage("short-conversation-test", "listener.png", "en")),
            exactName: rejects(() => subject.resolveLocalizedImage("listening-speaking-test", "istener.png", "en"))
        };
    });
    expect(result).toEqual({ allLoad: true, fixtureWidths: [17, 23], listener: "image", invalidLanguage: true, wrongGroup: true, exactName: true });
});

browserTest("renders the localized task headings, image labels, iframe title and partner-left message", async () => {
    const cases = [
        ["SctExplanation", {}, "img", "alt", "Short conversation test instructions"],
        ["LstExplanation", {}, "img", "alt", "Listening and speaking test instructions"],
        ["SctMain", { conditionAsset: "client-b/01.html" }, "iframe", "title", "Conversation card"],
        ["LstMain", { conditionAsset: "client-a/01.html" }, "iframe", "title", "Reading passage"],
        ["LstMain", { conditionAsset: "listener.png" }, "img", "alt", "Listening instructions"]
    ];
    for (const [view, state, tag, attribute, label] of cases) {
        await page.evaluate(([view, state]) => subject.render(view, "de", {}, state), [view, state]);
        await page.locator(`main ${tag}[${attribute}="DE: ${label}"]`).waitFor();
        const heading = view.endsWith("Explanation") ? "Instructions for the next conversation" : "Conversation room";
        expect(await page.locator("main h1").textContent()).toBe(`DE: ${heading}`);
    }
    await page.evaluate(() => subject.render("LstMain", "de", {}, { showDialog: true }));
    await page.getByRole("dialog", { name: "DE: Your conversation partner has left" }).waitFor();
    expect(await page.getByRole("dialog").textContent()).toContain("DE: You are now alone in the conversation room. You can leave the room and continue to the next screen.");
    await page.getByRole("button", { name: "DE: Close", exact: true }).last().click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
}, 20000);

browserTest("shows a localized error instead of an empty room when the task asset is missing", async () => {
    await page.evaluate(() => subject.render("SctMain", "de", {}, { conditionAsset: "01.html" }));
    const alert = page.getByRole("alert");
    await alert.waitFor({ timeout: 2500 });
    expect(await alert.textContent()).toBe("DE: The study material could not be loaded.");
    expect(await page.getByRole("button", { name: "DE: Continue" }).isDisabled()).toBe(true);
});

browserTest("keeps scale labels translated and the marker aligned with the existing tick geometry", async () => {
    await page.evaluate(() => subject.render("Scale", "de", { scaleName: "audio_quality" }));
    const image = page.locator('img[data-rating-scale="audio_quality"]');
    await image.waitFor({ timeout: 2500 });
    expect(await image.getAttribute("alt")).toBe("DE: Rating scale");
    const result = await image.evaluate(img => {
        img.getBoundingClientRect = () => ({ left: 200, width: 420 });
        img.nextElementSibling.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 410 }));
        return subject.scaleValues().audio_quality;
    });
    expect(result).toBeCloseTo(0.50080, 5);
    const marker = page.locator("div[style]", { has: page.locator("svg") });
    const position = await marker.evaluate(el => [parseFloat(el.style.left), parseFloat(el.style.top)]);
    expect(position).toEqual([50, 20]);
});
