import { useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslate } from "@/lib/helper-languages";
import { useRuntime } from "@/runtime/context";
import useStoreComponentDevicePicker from "@/stores/component-devicepicker";
import useStoreRoot from "@/stores/root";

const processingLabels = { echoCancellation: "Echo cancellation", noiseSuppression: "Noise suppression", autoGainControl: "Automatic gain control" };

function ComponentDevicePicker() {
    const __ = useTranslate();
    const runtime = useRuntime();
    const { snapshot } = useStoreRoot();
    const { open, loading, verified, activeCondition, sources, sinks, sourceId, sinkId, error, setOpen, setLoading, setVerified, setSources, setSinks, setSourceId, setSinkId, setError } = useStoreComponentDevicePicker();
    const [tested, setTested] = useState(null);
    const [heard, setHeard] = useState(false);
    const [peak, setPeak] = useState(0);
    const [processing, setProcessing] = useState(null);
    const reportError = (error) => {
        console.error(error);
        setError(true);
    };

    useEffect(() => {
        if (snapshot?.phase === "ended") setOpen(false);
        else if (snapshot?.setupRequired && !snapshot.setupComplete) setOpen(true);
    }, [snapshot?.phase, snapshot?.setupRequired, snapshot?.setupComplete, setOpen]);
    function invalidate() {
        setTested(null);
        setHeard(false);
        setVerified(false);
        runtime.devices.invalidate?.();
    }
    async function refreshDevices() {
        setLoading(true);
        setError(null);
        invalidate();
        try {
            if (!runtime.devices.list) throw new Error("Device setup is not available in this build");
            const devices = await runtime.devices.list();
            setSources(devices.inputs);
            setSinks(devices.outputs);
            setSourceId(devices.selection?.sourceId || "default");
            setSinkId(devices.selection?.sinkId || "default");
        }
        catch (error) {
            reportError(error);
        }
        finally {
            setLoading(false);
        }
    }
    async function testDevices() {
        setLoading(true);
        setError(null);
        setHeard(false);
        try {
            const selection = { sourceId, sinkId };
            const result = await runtime.devices.test(selection, { onLevel: setPeak });
            if (!result.inputUsable || !result.playbackComplete) throw new Error("Input check or test playback did not complete");
            setPeak(result.peak || 0);
            setTested(selection);
            setProcessing(result.processing || null);
        }
        catch (error) {
            setTested(null);
            reportError(error);
        }
        finally {
            setLoading(false);
        }
    }
    async function saveDevices() {
        if (!tested || !heard || activeCondition) return;
        setLoading(true);
        setError(null);
        try {
            await runtime.devices.save(tested);
            await runtime.dispatch("setupComplete", { inputUsable: true, playbackConfirmed: true });
            setVerified(true);
            setOpen(false);
        }
        catch (error) {
            reportError(error);
        }
        finally {
            setLoading(false);
        }
    }
    return (
        <Dialog open={open} onOpenChange={(next) => (next || verified) && setOpen(next)}>
            <DialogContent className="sm:max-w-lg" showCloseButton={verified}>
                <DialogHeader>
                    <DialogTitle>{__("Audio devices")}</DialogTitle>
                    <DialogDescription>{__("Select your microphone and audio output, play the test sample, and confirm that you can hear it. You won't hear your microphone through the output.")}</DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Button variant="outline" onClick={refreshDevices} disabled={loading || activeCondition}>
                        <RefreshCwIcon />
                        {__("Load or refresh devices")}
                    </Button>
                    {runtime.devices.mediaDevices?.selectAudioOutput && (
                        <Button
                            variant="outline"
                            disabled={loading || activeCondition}
                            onClick={async () => {
                                invalidate();
                                setError(null);
                                try {
                                    const chosen = await runtime.devices.chooseOutput();
                                    setSinks([...sinks.filter((device) => device.id !== chosen.id), chosen]);
                                    setSinkId(chosen.id);
                                }
                                catch (error) {
                                    reportError(error);
                                }
                            }}
                        >
                            {__("Choose an audio output")}
                        </Button>
                    )}
                    <Field>
                        <FieldLabel>{__("Microphone")}</FieldLabel>
                        <Select
                            value={sourceId}
                            onValueChange={(value) => {
                                setSourceId(value);
                                invalidate();
                            }}
                            disabled={loading || activeCondition}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder={__("Default microphone")} />
                            </SelectTrigger>
                            <SelectContent>
                                {sources.map((device) => (
                                    <SelectItem key={device.id} value={device.id}>
                                        {device.id === "default" ? __("Default microphone") : device.label || __("Unnamed microphone")}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <FieldDescription>{__("Wear headphones. Where supported, the browser's audio processing is turned off. The desktop app uses the configured system audio backend.")}</FieldDescription>
                    </Field>
                    <Field>
                        <FieldLabel>{__("Output")}</FieldLabel>
                        <Select
                            value={sinkId}
                            onValueChange={(value) => {
                                setSinkId(value);
                                invalidate();
                            }}
                            disabled={loading || activeCondition}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder={__("Default output")} />
                            </SelectTrigger>
                            <SelectContent>
                                {sinks.map((device) => (
                                    <SelectItem key={device.id} value={device.id}>
                                        {device.id === "default" ? __("Default output") : device.label || __("Unnamed audio output")}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Button onClick={testDevices} disabled={loading || activeCondition || !sourceId || !sinkId}>
                        {__("Check the microphone and play the P.501 sample")}
                    </Button>
                    {(loading || tested) && (
                        <label>
                            {__("Input peak")} <meter min="0" max="1" value={peak} />
                        </label>
                    )}
                    {processing && (
                        <FieldDescription>
                            {__("Browser audio processing (requested setting: off): {{settings}}.", {
                                settings: Object.entries(processingLabels)
                                    .map(([key, label]) => `${__(label)}: ${__(processing[key] == null || processing[key] === "unknown" ? "Unknown" : processing[key] ? "On" : "Off")}`)
                                    .join("; ")
                            })}
                        </FieldDescription>
                    )}
                    {tested && (
                        <label>
                            <input type="checkbox" checked={heard} onChange={(event) => setHeard(event.target.checked)} /> {__("I heard the test sample through the selected output.")}
                        </label>
                    )}
                    {error && <FieldError>{__("Could not check the selected audio devices. Check your connections and permissions, then try again.")}</FieldError>}
                </FieldGroup>
                <DialogFooter>
                    <Button onClick={saveDevices} disabled={loading || activeCondition || !tested || !heard}>
                        {loading ? __("Checking…") : __("Continue")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
export default ComponentDevicePicker;
