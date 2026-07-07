import { useEffect, useEffectEvent } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { enumerateAudioDevices, validateAudioDevices } from "@/lib/helper-webrtc";
import useStoreComponentDevicePicker from "@/stores/component-devicepicker";

function selectedDevice(devices, id) {
    return devices.find((device) => device.id === id) || null;
}

function ComponentDevicePicker() {
    const { open, loading, initialized, verified, activeCondition, sources, sinks, sourceId, sinkId, error, setOpen, setLoading, setInitialized, setVerified, setActiveCondition, setSources, setSinks, setSourceId, setSinkId, setError } = useStoreComponentDevicePicker();

    async function refreshDevices(initialError = null) {
        setLoading(true);
        setError(null);
        try {
            const settings = await window.appApi.ipcRenderer.invoke("ipc:audioDevicesGet");
            setActiveCondition(settings.active);
            const devices = await enumerateAudioDevices();
            setSources(devices.sources);
            setSinks(devices.sinks);
            if (initialError) setError(initialError);
        }
        catch (refreshError) {
            setError(refreshError.message);
            setOpen(true);
        }
        finally {
            setLoading(false);
        }
    }

    const refreshDevicesEvent = useEffectEvent((initialError = null) => {
        void refreshDevices(initialError);
    });

    useEffect(() => {
        let disposed = false;
        const removeOpenListener = window.appApi.ipcRenderer.on("ipc:audioDevicesOpen", (_, data) => {
            if (disposed) return;
            setOpen(true);
            refreshDevicesEvent(data?.error || null);
        });

        async function initialize() {
            setLoading(true);
            try {
                const settings = await window.appApi.ipcRenderer.invoke("ipc:audioDevicesGet");
                if (disposed) return;
                setSourceId(settings.source);
                setSinkId(settings.sink);

                const devices = await enumerateAudioDevices();
                if (disposed) return;
                setSources(devices.sources);
                setSinks(devices.sinks);
                const source = selectedDevice(devices.sources, settings.source);
                const sink = selectedDevice(devices.sinks, settings.sink);
                if (!source || !sink) throw new Error("The configured audio device is missing or no longer available");

                await validateAudioDevices(source.id, sink.id);
                await window.appApi.ipcRenderer.invoke("ipc:audioDevicesSetupComplete", {
                    source: { id: source.id, label: source.label },
                    sink: { id: sink.id, label: sink.label }
                });
                if (!disposed) {
                    setVerified(true);
                    setOpen(false);
                }
            }
            catch (initializationError) {
                if (!disposed) {
                    setError(initializationError.message);
                    setOpen(true);
                }
            }
            finally {
                if (!disposed) {
                    setInitialized(true);
                    setLoading(false);
                }
            }
        }

        void initialize();
        return () => {
            disposed = true;
            removeOpenListener();
        };
    }, [setActiveCondition, setError, setInitialized, setLoading, setOpen, setSinkId, setSinks, setSourceId, setSources, setVerified]);

    async function saveDevices() {
        if (activeCondition) {
            setError("Audio devices cannot be changed while a condition is active");
            return;
        }
        const source = selectedDevice(sources, sourceId);
        const sink = selectedDevice(sinks, sinkId);
        if (!source || !sink) {
            setError("Select an available microphone and output device");
            return;
        }

        setLoading(true);
        setError(null);
        try {
            await validateAudioDevices(source.id, sink.id);
            await window.appApi.ipcRenderer.invoke("ipc:audioDevicesSave", { source: source.id, sink: sink.id });
            await window.appApi.ipcRenderer.invoke("ipc:audioDevicesSetupComplete", {
                source: { id: source.id, label: source.label },
                sink: { id: sink.id, label: sink.label }
            });
            setVerified(true);
            setOpen(false);
        }
        catch (saveError) {
            setError(saveError.message);
        }
        finally {
            setLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen || verified) && setOpen(nextOpen)}>
            <DialogContent className="sm:max-w-lg" showCloseButton={initialized && verified}>
                <DialogHeader>
                    <DialogTitle>Audio devices</DialogTitle>
                    <DialogDescription>Select the browser microphone and output used for every experiment condition. Device access is checked before connecting to the server.</DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Field>
                        <FieldLabel>Microphone</FieldLabel>
                        <Select value={sourceId} onValueChange={setSourceId} disabled={loading}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select a microphone" />
                            </SelectTrigger>
                            <SelectContent>
                                {sources.map((device) => (
                                    <SelectItem key={device.id} value={device.id}>
                                        {device.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <FieldDescription>Browser echo cancellation, noise suppression, and automatic gain are disabled and verified.</FieldDescription>
                    </Field>
                    <Field>
                        <FieldLabel>Output</FieldLabel>
                        <Select value={sinkId} onValueChange={setSinkId} disabled={loading}>
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select an output" />
                            </SelectTrigger>
                            <SelectContent>
                                {sinks.map((device) => (
                                    <SelectItem key={device.id} value={device.id}>
                                        {device.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <FieldDescription>Choose Default output when explicit speaker selection is unavailable.</FieldDescription>
                    </Field>
                    {error && <FieldError errors={[]}>{error}</FieldError>}
                </FieldGroup>
                <DialogFooter>
                    <Button variant="outline" onClick={() => refreshDevices()} disabled={loading}>
                        <RefreshCwIcon />
                        Refresh
                    </Button>
                    <Button onClick={saveDevices} disabled={loading || activeCondition || !sourceId || !sinkId}>
                        {loading ? "Checking..." : "Save and verify"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default ComponentDevicePicker;
