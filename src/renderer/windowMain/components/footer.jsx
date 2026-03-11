import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button"

function ComponentFooter() {
    const requestNextView = () => {
        window.appApi.ipcRenderer.invoke("ipc:nextViewRequested", {});
    };

    return (
        <>
            <div className="flex flex-none mt-8 justify-end">
                <Button className="cursor-pointer" onClick={requestNextView}>
                    Next <ArrowRight data-icon="inline-end" />
                </Button>
            </div>
        </>
    );
}

export default ComponentFooter;