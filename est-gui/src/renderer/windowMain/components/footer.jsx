import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTranslate } from "@/lib/helper-languages";
import { useRuntime } from "@/runtime/context";
import useStoreComponentFooter from "@/stores/component-footer";
import useStoreRoot from "@/stores/root";

function ComponentFooter({ onNext, disabled }) {
    const __ = useTranslate();
    const runtime = useRuntime();
    const { isWaitingForPeer, setIsWaitingForPeer, isWaitingForUpload, isWaitingForRecording } = useStoreComponentFooter();
    const { currentView } = useStoreRoot();

    const isWaiting = isWaitingForPeer || isWaitingForUpload || isWaitingForRecording;
    let label = __("Continue");

    if (isWaitingForPeer) {
        label = __("Waiting for your partner");
    }
    else if (isWaitingForUpload) {
        label = __("Uploading audio");
    }
    else if (isWaitingForRecording) {
        label = __("Preparing audio");
    }

    const requestNextView = async () => {
        setIsWaitingForPeer(true);

        try {
            if (onNext) {
                const success = await onNext();
                if (success === false) {
                    setIsWaitingForPeer(false);
                }
            }
            else {
                await runtime.dispatch("nextView", {
                    currentView: currentView
                });
            }
        }
        catch (error) {
            setIsWaitingForPeer(false);
            runtime.onError(error);
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
