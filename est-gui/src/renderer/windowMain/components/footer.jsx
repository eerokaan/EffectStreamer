import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import useStoreComponentFooter from "@/stores/component-footer";
import useStoreRoot from "@/stores/root";

function ComponentFooter({ onNext, disabled }) {
    const { isWaitingForPeer, setIsWaitingForPeer, isWaitingForUpload, isWaitingForRecording } = useStoreComponentFooter();
    const { currentView } = useStoreRoot();

    const isWaiting = isWaitingForPeer || isWaitingForUpload || isWaitingForRecording;
    let label = "Weiter";
    
    if (isWaitingForPeer) {
        label = "Warte auf Partner";
    }
    else if (isWaitingForUpload) {
        label = "Audiodaten werden hochgeladen";
    }
    else if (isWaitingForRecording) {
        label = "Audio wird vorbereitet";
    }

    const requestNextView = async () => {
        setIsWaitingForPeer(true);

        if (onNext) {
            const success = await onNext();
            if (success === false) {
                setIsWaitingForPeer(false);
            }
        }
        else {
            window.appApi.ipcRenderer.invoke("ipc:viewChangeRequest", {
                currentView: currentView
            });
        }
    };

    return (
        <>
            <div className="mt-8 flex flex-none justify-end">
                <Button variant="default" onClick={requestNextView} disabled={isWaiting || disabled}>
                    {label} {isWaiting ? <Spinner data-icon="inline-end" /> : <ArrowRight data-icon="inline-end" />}
                </Button>
            </div>
        </>
    );
}

export default ComponentFooter;
