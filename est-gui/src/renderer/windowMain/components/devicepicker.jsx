import { useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRuntime } from "@/runtime/context";
import useStoreRoot from "@/stores/root";
import useStoreComponentDevicePicker from "@/stores/component-devicepicker";

function ComponentDevicePicker() {
    const runtime = useRuntime();
    const { snapshot } = useStoreRoot();
    const { open, loading, verified, activeCondition, sources, sinks, sourceId, sinkId, error, setOpen, setLoading, setVerified, setSources, setSinks, setSourceId, setSinkId, setError } = useStoreComponentDevicePicker();
    const [tested, setTested] = useState(null);
    const [heard, setHeard] = useState(false);
    const [peak, setPeak] = useState(0);
    const [processing, setProcessing] = useState(null);

    useEffect(() => { if (snapshot?.setupRequired && !snapshot.setupComplete) setOpen(true); }, [snapshot?.setupRequired, snapshot?.setupComplete, setOpen]);
    function invalidate() { setTested(null); setHeard(false); setVerified(false); runtime.devices.invalidate?.(); }
    async function refreshDevices() {
        setLoading(true); setError(null); invalidate();
        try {
            if (!runtime.devices.list) throw new Error("Device setup is not available in this build");
            const devices = await runtime.devices.list();
            setSources(devices.inputs); setSinks(devices.outputs);
            setSourceId(devices.selection?.sourceId || "default"); setSinkId(devices.selection?.sinkId || "default");
        }
        catch (error) { setError(error.message); }
        finally { setLoading(false); }
    }
    async function testDevices() {
        setLoading(true); setError(null); setHeard(false);
        try {
            const selection = { sourceId, sinkId };
            const result = await runtime.devices.test(selection, { onLevel: setPeak });
            if (!result.inputUsable || !result.playbackComplete) throw new Error("Input check or test playback did not complete");
            setPeak(result.peak || 0); setTested(selection);
            setProcessing(result.processing || null);
        }
        catch (error) { setTested(null); setError(error.message); }
        finally { setLoading(false); }
    }
    async function saveDevices() {
        if (!tested || !heard || activeCondition) return;
        setLoading(true);setError(null);
        try {
            await runtime.devices.save(tested);
            await runtime.dispatch("setupComplete", { inputUsable: true, playbackConfirmed: true });
            setVerified(true);setOpen(false);
        }
        catch (error) { setError(error.message); }
        finally { setLoading(false); }
    }
    return (
        <Dialog open={open} onOpenChange={next => (next || verified) && setOpen(next)}>
            <DialogContent className="sm:max-w-lg" showCloseButton={verified}>
                <DialogHeader>
                    <DialogTitle>Audio devices</DialogTitle>
                    <DialogDescription>Select your microphone and output, play the test sample, and confirm you can hear it. No microphone monitoring is played through your speakers.</DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Button variant="outline" onClick={refreshDevices} disabled={loading || activeCondition}><RefreshCwIcon />Load / refresh devices</Button>
                    {runtime.devices.mediaDevices?.selectAudioOutput && <Button variant="outline" disabled={loading || activeCondition} onClick={async () => {
                        invalidate();setError(null);
                        try {const chosen = await runtime.devices.chooseOutput();setSinks([...sinks.filter(device => device.id !== chosen.id), chosen]);setSinkId(chosen.id);}
                        catch (error) {setError(error.message);}
                    }}>Grant permission / choose output</Button>}
                    <Field>
                        <FieldLabel>Microphone</FieldLabel>
                        <Select value={sourceId} onValueChange={value => {setSourceId(value);invalidate();}} disabled={loading || activeCondition}>
                            <SelectTrigger className="w-full"><SelectValue placeholder="Default microphone" /></SelectTrigger>
                            <SelectContent>{sources.map(device => <SelectItem key={device.id} value={device.id}>{device.label}</SelectItem>)}</SelectContent>
                        </Select>
                        <FieldDescription>Use headphones. Browser audio processing is disabled where supported; native audio uses the configured OS backend.</FieldDescription>
                    </Field>
                    <Field>
                        <FieldLabel>Output</FieldLabel>
                        <Select value={sinkId} onValueChange={value => {setSinkId(value);invalidate();}} disabled={loading || activeCondition}>
                            <SelectTrigger className="w-full"><SelectValue placeholder="Default output" /></SelectTrigger>
                            <SelectContent>{sinks.map(device => <SelectItem key={device.id} value={device.id}>{device.label}</SelectItem>)}</SelectContent>
                        </Select>
                    </Field>
                    <Button onClick={testDevices} disabled={loading || activeCondition || !sourceId || !sinkId}>Check input and play P.501 sample</Button>
                    {(loading || tested) && <label>Input peak <meter min="0" max="1" value={peak} /></label>}
                    {processing && <FieldDescription>Requested audio processing off. Browser reports: {Object.entries(processing).map(([key, value]) => key + ": " + (value === "unknown" ? "unknown" : value ? "enabled" : "off")).join("; ")}.</FieldDescription>}
                    {tested && <label><input type="checkbox" checked={heard} onChange={event => setHeard(event.target.checked)} /> I heard the test sample through the selected output.</label>}
                    {error && <FieldError errors={[]}>{error}</FieldError>}
                </FieldGroup>
                <DialogFooter><Button onClick={saveDevices} disabled={loading || activeCondition || !tested || !heard}>{loading ? "Checking…" : "Continue"}</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
export default ComponentDevicePicker;
