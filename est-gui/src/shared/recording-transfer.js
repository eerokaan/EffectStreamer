async function fetchRequest(method, url, body, { headers, signal } = {}) {
    const binary = body instanceof Uint8Array || body instanceof ArrayBuffer || (typeof Blob !== "undefined" && body instanceof Blob);
    const response = await fetch(url, {
        method, headers: { ...headers, ...(body == null ? {} : { "content-type": binary ? "application/octet-stream" : "application/json" }) },
        body: body == null ? undefined : binary ? body : JSON.stringify(body), signal
    });
    if (!response.ok) throw new Error("Recording upload failed (" + response.status + "): " + await response.text());
    return response.json();
}

export async function uploadRecording({ manifest, readChunk, request = fetchRequest, onReceipt, baseUrl = "", headers = {}, chunkBytes = 1048576, maxRetries = 2, timeoutMs = 600000 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Recording upload deadline exceeded")), timeoutMs);
    const call = (method, suffix, body) => request(method, baseUrl + "/api/recordings" + suffix, body, { headers, signal: controller.signal });
    let lastError;
    try {
        for (let attempt = 0; attempt <= maxRetries && !controller.signal.aborted; attempt++) {
            try {
                const started = await call("POST", "", manifest);
                if (typeof started.uploadId !== "string" || !/^[A-Za-z0-9_-]+$/.test(started.uploadId) || !Number.isSafeInteger(started.nextByteOffset) || started.nextByteOffset < 0 || started.nextByteOffset > manifest.byteLength) throw new Error("Invalid upload resume response");
                let offset = started.nextByteOffset;
                while (offset < manifest.byteLength) {
                    const length = Math.min(chunkBytes, manifest.byteLength - offset);
                    const bytes = await readChunk(manifest.recordingId, offset, length);
                    const result = await call("PUT", "/" + started.uploadId + "/chunks/" + offset, bytes);
                    if (result.nextByteOffset !== offset + length) throw new Error("Unexpected upload offset acknowledgement");
                    offset = result.nextByteOffset;
                }
                const receipt = await call("POST", "/" + started.uploadId + "/complete");
                if (receipt.recordingId !== manifest.recordingId || receipt.sha256 !== manifest.sha256 || receipt.stored !== true) throw new Error("Invalid recording storage receipt");
                await onReceipt(receipt);
                return receipt;
            }
            catch (error) { lastError = error; }
        }
        throw lastError || controller.signal.reason || new Error("Recording upload failed");
    }
    finally { clearTimeout(timer); }
}
