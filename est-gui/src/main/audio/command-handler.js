export async function handleNativeCommand(audio, command) {
    if (command.type === "reconnected") {
        const snapshot = command.snapshot;
        if (!snapshot.sessionId) return;
        if (audio.current && (snapshot.phase === "interrupted" || snapshot.phase === "ended" || audio.current.stopPromise)) {
            const previous = audio.current.scope;
            await audio.stop(previous).catch(() => {});await audio.recordings(previous, { status: "interrupted" }).catch(() => {});
        }
        await audio.loadPending();
        const manifests = [...audio.pending.values()].map(entry => entry.manifest).filter(manifest => manifest.sessionId === snapshot.sessionId && manifest.participantId === snapshot.participantId);
        if (!snapshot.attemptId && !snapshot.viewData?.recovery && !manifests.length) return;
        return { type: "resume", scope: { sessionId: snapshot.sessionId, participantId: snapshot.participantId, attemptId: snapshot.attemptId }, payload: { manifests, mediaPresent: Boolean(audio.current) } };
    }
    if (command.type === "disconnected") {
        if (audio.current) {
            const scope = audio.current.scope;
            await audio.stop(scope).catch(() => {});
            await audio.recordings(scope, { status: "interrupted" }).catch(() => {});
        }
        return;
    }
    const scope = { sessionId: command.sessionId, attemptId: command.attemptId, participantId: command.participantId };
    try {
        if (command.type === "prepareCore") {
            await audio.prepare({ scope, component: command.component, condition: command.condition, peer: command.peer, ports: command.ports });
            return { type: "mediaPrepared", scope, payload: { component: command.component, success: true } };
        }
        if (command.type === "startAudio") {await audio.start(scope);return { type: "mediaStarted", scope, payload: { success: true } };}
        if (command.type === "stopCore") {
            let failure;
            try { if (audio.current) await audio.stop(scope); } catch (error) { failure = error; }
            const manifests = await audio.recordings(scope, { status: failure || command.reason !== "completed" ? "interrupted" : "complete" });
            return [{ type: "mediaStopped", scope, payload: { success: !failure, error: failure?.message } }, { type: "recordingsFinalized", scope, payload: { manifests } }];
        }
        throw new Error("Unknown native media command");
    }
    catch (error) { return { type: "mediaFailed", scope, payload: { message: error.message } }; }
}
