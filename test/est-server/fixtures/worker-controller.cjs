const { RemoteMediaAdapter } = require("../../../est-server/src/media/RemoteMediaAdapter.js");
const { PortAllocator } = require("../../../est-server/src/media/PortAllocator.js");
process.once("message", async config => {
    const adapter = new RemoteMediaAdapter({ config, allocator: new PortAllocator([32400, 32499]), clientRegistry: { emitToSocket() {} } });
    await adapter.prepare({ session: { sessionId: "parent-test", clientsData: new Map([["p-a", {}], ["p-b", {}]]) }, attempt: { contextKey: "attempt-parent" }, condition: {} });
    process.send({ worker: adapter.child.pid, cores: (await adapter.request("health")).children.map(child => child.pid) });
});
