import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import Dummy from "./l1_Dummy";
import useStoreSectionBody from "@/stores/l0_SectionBody";

function SectionBody() {
    const { dialogOpen, dialogTitle, dialogDescription, dialogButton, updateStates: updateStatesSectionBody } = useStoreSectionBody();

    return (
        <>
            <div className="h-full min-h-fit bg-white p-4">
                <Dialog open={dialogOpen} onOpenChange={(event) => updateStatesSectionBody({ dialogOpen: event })}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{dialogTitle}</DialogTitle>
                            <DialogDescription>{dialogDescription}</DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button type="button">{dialogButton}</Button>
                            </DialogClose>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dummy></Dummy>
            </div>
        </>
    );
}

export default SectionBody;
