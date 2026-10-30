const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { identifier } = require("@effectstreamer/common");

class SessionStore {
    constructor(root) {
        this.root = path.resolve(root);
        this.pending = new Map();
        fs.mkdirSync(this.root, { recursive: true });
    }

    save(session) {
        let id, contents;
        try {
            id = identifier(session.sessionId, "sessionId");
            contents = JSON.stringify(session, null, 4) + "\n";
        }
        catch (error) {
            return Promise.reject(error);
        }
        const previous = this.pending.get(id) || Promise.resolve();
        const next = previous.catch(() => {}).then(async () => {
            const directory = path.join(this.root, id);
            await fs.promises.mkdir(directory, { recursive: true });
            const destination = path.join(directory, "session.json");
            const temporary = destination + ".tmp-" + randomUUID();
            try {
                const file = await fs.promises.open(temporary, "wx", 0o600);
                try { await file.writeFile(contents); await file.sync(); }
                finally { await file.close(); }
                await fs.promises.rename(temporary, destination);
            }
            catch (error) {
                await fs.promises.rm(temporary, { force: true }).catch(() => {});
                throw error;
            }
        });
        this.pending.set(id, next);
        return next;
    }

    async loadAll() {
        await Promise.all(this.pending.values());
        const result = [];
        for (const entry of await fs.promises.readdir(this.root, { withFileTypes: true })) {
            if (!entry.isDirectory() || !/^[A-Za-z0-9_-]{1,128}$/.test(entry.name)) continue;
            try {
                const value = JSON.parse(await fs.promises.readFile(path.join(this.root, entry.name, "session.json"), "utf8"));
                if (value.sessionId !== entry.name) throw new Error("Session manifest identity mismatch");
                result.push(value);
            }
            catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
        }
        return result;
    }
}
module.exports = { SessionStore };
