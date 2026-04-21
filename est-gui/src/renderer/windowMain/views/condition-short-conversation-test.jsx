import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { conditionSctImages, resolveImage } from "@/lib/helper-images";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import useStoreRoot from "@/stores/root";

function ViewShortConversationTest() {
    const { conditionImage, showDialog, setShowDialog } = useStoreRoot();
    const imageSrc = resolveImage(conditionSctImages, conditionImage);

    useEffect(() => {
        window.appApi.ipcRenderer.invoke("ipc:coreStartRequest", {
            component: "sender"
        });
        return () => {
            window.appApi.ipcRenderer.invoke("ipc:coreStopRequest", {
                testType: "sct"
            });
        };
    }, []);

    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Gesprächsraum"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <img src={imageSrc} alt="Test Image" className="block w-full" draggable="false" />
                </div>

                <ComponentFooter></ComponentFooter>
            </div>

            <Dialog open={showDialog} onOpenChange={setShowDialog}>
                <DialogContent showCloseButton={true}>
                    <DialogHeader>
                        <DialogTitle>Der Gesprächspartner hat das Gespräch verlassen</DialogTitle>
                        <DialogDescription>Sie befinden sich nun alleine im Gespächsraum. Sie können nun auch den Raum verlassen und zur nächsten Ansicht gehen.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="default" onClick={() => setShowDialog(false)}>
                            Schließen
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export default ViewShortConversationTest;
