import protocol from "@effectstreamer/common";

export function createSessionClient({ transport, participantId, onSnapshot = () => {}, onCommand = () => {}, onError = () => {}, timeoutMs = 10000 }) {
    const { EVENTS } = protocol;
    const listeners = [];
    const pending = new Set();
    let current = null, disposed = false;
    function listen(event, handler) { transport.on(event, handler); listeners.push(() => transport.off(event, handler)); }
    function accept(snapshot) {
        if (disposed || !snapshot || snapshot.participantId !== participantId || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) return;
        if (current?.sessionId && snapshot.sessionId !== current.sessionId) return;
        if (current && current.sessionId === snapshot.sessionId && snapshot.revision <= current.revision) return;
        current = snapshot; onSnapshot(snapshot);
    }
    function command(value) { if (!disposed) void Promise.resolve(onCommand(value)).catch(onError); }
    listen(EVENTS.snapshot, accept);
    listen(EVENTS.mediaCommand, command);
    listen(EVENTS.recordingRequest, value => command({ ...value, type: "collectRecordings" }));
    listen("connect_error", onError);
    listen("disconnect", reason => command({ type: "disconnected", reason }));
    // Temporary translation while native coordinator commands migrate to MediaAdapter.
    listen("est-event:coreStartRequest", value => command({ ...value, type: "prepareCore" }));
    listen("est-event:coreStopRequest", value => command({ ...value, type: "stopCore" }));
    return {
        snapshot: () => current,
        dispatch(type, payload = {}, { scope } = {}) {
            if (disposed) return Promise.reject(new Error("Runtime is disposed"));
            const message = { version: 1, requestId: crypto.randomUUID(), sessionId: current?.sessionId ?? null, participantId, attemptId: current?.attemptId ?? null, ...scope, type, payload };
            protocol.validateEnvelope(message);
            return new Promise((resolve, reject) => {
                const item = { reject, timer: setTimeout(() => { pending.delete(item); reject(new Error("Coordinator action timed out")); }, timeoutMs) };
                pending.add(item);
                transport.emit(["mediaPrepared", "mediaStarted", "mediaStopped", "mediaFailed", "recordingsFinalized"].includes(type) ? EVENTS.mediaResult : EVENTS.action, message, response => {
                    if (!pending.delete(item)) return;
                    clearTimeout(item.timer);
                    if (response?.requestId !== message.requestId || response.ok !== true) { reject(new Error(response?.error || "Invalid coordinator acknowledgement")); return; }
                    if (response.snapshot) accept(response.snapshot);
                    resolve(response.snapshot);
                });
            });
        },
        dispose() {
            disposed = true;
            for (const remove of listeners) remove();
            for (const item of pending) { clearTimeout(item.timer); item.reject(new Error("Runtime disposed")); }
            pending.clear();
        }
    };
}
