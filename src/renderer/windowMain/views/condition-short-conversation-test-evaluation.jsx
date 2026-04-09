import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import ComponentScale from "@/components/scale";
import useStoreComponentScale from "@/stores/component-scale";
import useStoreComponentScaleEvaluation from "@/stores/component-scale-evaluation";
import useStoreRoot from "@/stores/root";
import { scaleOrder, scaleDetails } from "@/lib/scale-definitions";

function ViewShortConversationTestEvaluation() {
    const { scaleIndex, setScaleIndex } = useStoreComponentScaleEvaluation();
    const { scaleValues } = useStoreComponentScale();
    const { currentView } = useStoreRoot();

    const scaleName = scaleOrder[scaleIndex];
    const scaleDetail = scaleDetails[scaleName];
    const isLastScale = scaleIndex === scaleOrder.length - 1;
    const hasSelection = scaleValues[scaleName] != null;

    const handleScaleTransfer = () => {
        window.appApi.ipcRenderer.invoke("ipc:viewChangeRequest", {
            currentView: currentView,
            scaleValues: scaleValues
        });
    };

    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline={"Short Conversation Test: Evaluation (" + scaleDetail.displayName + ")"}></ComponentHeader>

                <div className="flex-1">
                    <ComponentScale scaleName={scaleName}></ComponentScale>
                </div>

                <div className="flex-1">
                    <p>{scaleDetail.description}</p>
                </div>

                {isLastScale ? (
                    <ComponentFooter onNext={handleScaleTransfer} disabled={!hasSelection}></ComponentFooter>
                ) : (
                    <div className="mt-8 flex flex-none justify-end">
                        <Button className="cursor-pointer" onClick={() => setScaleIndex(scaleIndex + 1)} disabled={!hasSelection}>
                            Next <ArrowRight data-icon="inline-end" />
                        </Button>
                    </div>
                )}
            </div>
        </>
    );
}

export default ViewShortConversationTestEvaluation;
