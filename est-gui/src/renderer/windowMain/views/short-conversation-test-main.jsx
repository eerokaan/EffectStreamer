import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadStudyAsset, resolveTaskAsset } from "@/lib/helper-assets";
import { useSessionLanguage, useTranslate } from "@/lib/helper-languages";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import useStoreRoot from "@/stores/root";

function ViewShortConversationTestMain() {
    const { conditionAsset, showDialog, setShowDialog } = useStoreRoot();
    const language = useSessionLanguage();
    const __ = useTranslate();
    const asset = loadStudyAsset(() => resolveTaskAsset("short-conversation-test", conditionAsset, language, __));

    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline={__("Conversation room")} />

                <div className="flex w-full max-w-5xl flex-1 flex-col">
                    {asset ? <iframe srcDoc={asset.srcDoc} className="w-full flex-1 border-none" title={__("Conversation card")} /> : <p role="alert">{__("The study material could not be loaded.")}</p>}
                </div>

                <ComponentFooter disabled={!asset} />
            </div>

            <Dialog open={showDialog} onOpenChange={setShowDialog}>
                <DialogContent showCloseButton={true}>
                    <DialogHeader>
                        <DialogTitle>{__("Your conversation partner has left")}</DialogTitle>
                        <DialogDescription>{__("You are now alone in the conversation room. You can leave the room and continue to the next screen.")}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="default" onClick={() => setShowDialog(false)}>
                            {__("Close")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export default ViewShortConversationTestMain;
