import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import useStoreComponentFooter from "@/stores/component-footer";
import useStoreRoot from "@/stores/root";

function ComponentFooter({ onNext, disabled }) {
    const { isWaitingForPeer, setIsWaitingForPeer, isWaitingForUpload } = useStoreComponentFooter();
    const { currentView } = useStoreRoot();

    const requestNextView = () => {
        setIsWaitingForPeer(true);

        if (onNext) {
            onNext();
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
                <Button variant="default" onClick={requestNextView} disabled={isWaitingForPeer || isWaitingForUpload || disabled}>
                    {isWaitingForUpload ? "Audiodaten werden hochgeladen" : isWaitingForPeer ? "Warte auf Partner" : "Weiter"} {isWaitingForUpload || isWaitingForPeer ? <Spinner data-icon="inline-end" /> : <ArrowRight data-icon="inline-end" />}
                </Button>
            </div>
        </>
    );
}

export default ComponentFooter;
