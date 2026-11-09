import fs from "node:fs/promises";
import { writeFileDirect } from "@effectstreamer/common/direct-write";

export async function loadLocalEnrollment({ url, identity, ipAddress, operatingSystem, credentialsPath }) {
    let saved;
    try {saved = JSON.parse(await fs.readFile(credentialsPath, "utf8"));}
    catch (error) {if (error.code !== "ENOENT") throw error;}
    const reconnectToken = saved?.url === url && saved.identity === identity ? saved.credentials.reconnectToken : undefined;
    const response = await fetch(url + "/api/enrollment", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ identity, ipAddress, operatingSystem, reconnectToken })
    });
    if (!response.ok) throw new Error((await response.json()).error || "Participant admission failed");
    saved = { url, identity, credentials: await response.json() };
    await writeFileDirect(credentialsPath, JSON.stringify(saved));
    return saved;
}
