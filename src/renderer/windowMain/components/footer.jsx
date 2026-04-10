import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import useStoreComponentFooter from "@/stores/component-footer";
import useStoreRoot from "@/stores/root";

function ComponentFooter({ onNext, disabled }) {
    const { isWaiting, isUploading, setIsWaiting } = useStoreComponentFooter();
    const { currentView } = useStoreRoot();

    const requestNextView = () => {
        setIsWaiting(true);

        if (onNext) {
            onNext();
        }
        else {
            window.appApi.ipcRenderer.invoke("ipc:viewChangeRequest", {
                currentView: currentView
            });
        }
    };

    const waitingLabel = isUploading ? "Uploading audio files" : "Waiting for partner";

    return (
        <>
            <div className="mt-8 flex flex-none justify-end">
                <Button className="cursor-pointer" onClick={requestNextView} disabled={isWaiting || disabled}>
                    {isWaiting ? waitingLabel : "Next"} {isWaiting ? <Spinner data-icon="inline-end" /> : <ArrowRight data-icon="inline-end" />}
                </Button>
            </div>
        </>
    );
}

export default ComponentFooter;
