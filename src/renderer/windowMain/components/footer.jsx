import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import useStoreComponentFooter from "@/stores/component-footer";
import useStoreRoot from "@/stores/root";

function ComponentFooter({ onNext, disabled }) {
    const { isWaiting, setIsWaiting } = useStoreComponentFooter();
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

    return (
        <>
            <div className="mt-8 flex flex-none justify-end">
                <Button className="cursor-pointer" onClick={requestNextView} disabled={isWaiting || disabled}>
                    {isWaiting ? "Waiting for partner" : "Next"} {isWaiting ? <Spinner data-icon="inline-end" /> : <ArrowRight data-icon="inline-end" />}
                </Button>
            </div>
        </>
    );
}

export default ComponentFooter;
