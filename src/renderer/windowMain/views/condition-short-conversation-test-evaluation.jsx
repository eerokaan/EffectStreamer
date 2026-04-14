import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { scaleDetails, getPermutedScaleOrder } from "@/lib/scale-definitions";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import ComponentScale from "@/components/scale";
import useStoreComponentScale from "@/stores/component-scale";
import useStoreComponentScaleEvaluation from "@/stores/component-scale-evaluation";
import useStoreRoot from "@/stores/root";

function ViewShortConversationTestEvaluation() {
    const { scaleIndex, setScaleIndex } = useStoreComponentScaleEvaluation();
    const { scaleValues } = useStoreComponentScale();
    const { currentView, scaleOffset, setScaleOffset } = useStoreRoot();

    // Initialize the random scale offset once per session
    useEffect(() => {
        if (scaleOffset === null) {
            setScaleOffset(Math.floor(Math.random() * 7));
        }
    }, [scaleOffset, setScaleOffset]);

    const permutedScaleOrder = getPermutedScaleOrder(scaleOffset ?? 0);
    const scaleName = permutedScaleOrder[scaleIndex];
    const scaleDetail = scaleDetails[scaleName];
    const isLastScale = scaleIndex === permutedScaleOrder.length - 1;
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
                <ComponentHeader
                    headline={
                        <>
                            Short Conversation Test:
                            <br />
                            Evaluation ({scaleDetail.displayName})
                        </>
                    }
                ></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <ComponentScale scaleName={scaleName}></ComponentScale>
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
