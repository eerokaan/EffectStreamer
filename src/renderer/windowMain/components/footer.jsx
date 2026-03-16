import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import useStoreComponentFooter from "@/stores/component-footer";

function ComponentFooter() {
    const { isWaiting, setIsWaiting } = useStoreComponentFooter();

    const requestNextView = () => {
        setIsWaiting(true);
        window.appApi.ipcRenderer.invoke("ipc:nextViewRequested", {});
    };

    return (
        <>
            <div className="flex flex-none mt-8 justify-end">
                <Button className="cursor-pointer" onClick={requestNextView} disabled={isWaiting}>
                    {isWaiting ? "Waiting for partner" : "Next"} {isWaiting ? <Spinner data-icon="inline-end" /> : <ArrowRight data-icon="inline-end" />}
                </Button>
            </div>
        </>
    );
}

export default ComponentFooter;