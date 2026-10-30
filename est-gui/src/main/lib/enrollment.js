import fs from "node:fs/promises";

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
    const temporary = credentialsPath + ".tmp-" + process.pid;
    await fs.writeFile(temporary, JSON.stringify(saved), { mode: 0o600 });
    await fs.rename(temporary, credentialsPath);
    return saved;
}
