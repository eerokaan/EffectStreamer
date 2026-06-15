import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getListeningSpeakingTestScaleOrder, scaleDetails } from "@/lib/helper-scales";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import ComponentScale from "@/components/scale";
import useStoreComponentScale from "@/stores/component-scale";
import useStoreRoot from "@/stores/root";

function ViewListeningSpeakingTestEvaluation() {
    const { scaleIndex, setScaleIndex, scaleValues } = useStoreComponentScale();
    const { currentView, conditionScaleOffset, setConditionScaleOffset, conditionListeningSpeakingTestRole } = useStoreRoot();

    // Initialize the random scale offset once per session
    useEffect(() => {
        if (conditionScaleOffset === null) {
            setConditionScaleOffset(Math.floor(Math.random() * 7));
        }
    }, [conditionScaleOffset, setConditionScaleOffset]);

    const permutedScaleOrder = getListeningSpeakingTestScaleOrder(conditionScaleOffset ?? 0, conditionListeningSpeakingTestRole);
    const scaleName = permutedScaleOrder[scaleIndex] ?? permutedScaleOrder[0];
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
                            Auswertung des Gesprächs:
                            <br />
                            {scaleDetail.displayName}
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
                        <Button onClick={() => setScaleIndex(scaleIndex + 1)} disabled={!hasSelection}>
                            Weiter <ArrowRight data-icon="inline-end" />
                        </Button>
                    </div>
                )}
            </div>
        </>
    );
}

export default ViewListeningSpeakingTestEvaluation;
