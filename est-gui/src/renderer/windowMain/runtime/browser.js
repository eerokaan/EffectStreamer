import { createParticipantRuntime } from "./create-runtime.js";

async function initializeBrowser() {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Unable to load study configuration");
    const config = await response.json();
    const query = Object.fromEntries(new URLSearchParams(location.search));
    const key = "effectstreamer:" + (query.SESSION_ID || query.identity || "participant");
    let credentials;
    try { credentials = JSON.parse(sessionStorage.getItem(key)); } catch { /* Ignore invalid local state. */ }
    if (!credentials) {
        const admitted = await fetch("/api/enrollment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identity: query.identity, query }) });
        if (!admitted.ok) throw new Error((await admitted.json()).error || "Study admission failed");
        credentials = await admitted.json(); sessionStorage.setItem(key, JSON.stringify(credentials));
    }
    return { config, credentials, url: location.origin };
}
export function createRuntime({ initialize = initializeBrowser, transportFactory, devices, media, recordings } = {}) {
    return createParticipantRuntime({ initialize, transportFactory, devices, media, recordings });
}
