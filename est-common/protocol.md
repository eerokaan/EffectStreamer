# Application protocol v1

The browser-safe package entry exports `EVENTS`, `ACTIONS`, `validateScope`, `validateEnvelope`, and `validateManifest`. Node-only core supervision is a separate `@effectstreamer/common/core-process` entry.

Actions contain `{version:1,requestId,sessionId,participantId,attemptId,type,payload}`. Session and attempt are null before pairing; attempt is null between conditions. Participant membership is authenticated separately; identifiers in a message are never authentication. The coordinator validates the current view/attempt before applying an action. Snapshots include an increasing `revision`, stable participant/role, view data and setup/completion state.

Finalized recordings are announced in `mediaResult`, then requested by ID. Manifests contain only identity/track/source, canonical WAV filename/content type, byte length, SHA-256 and operational `complete`/`interrupted` status. No alignment/timing sidecars are produced. Transfer requests for retained earlier attempts may complete before the upload deadline, without advancing the current attempt. Only `{recordingId,sha256,stored:true}` from durable storage releases client data.
