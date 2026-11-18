import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslate } from "@/lib/helper-languages";
import { getPermutedScaleOrder, scaleDetails } from "@/lib/helper-scales";
import { useRuntime } from "@/runtime/context";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import ComponentScale from "@/components/scale";
import useStoreComponentScale from "@/stores/component-scale";
import useStoreRoot from "@/stores/root";

function ViewShortConversationTestEvaluation() {
    const __ = useTranslate();
    const runtime = useRuntime();
    const { scaleIndex, setScaleIndex, scaleValues } = useStoreComponentScale();
    const { currentView, conditionScaleOffset, setConditionScaleOffset } = useStoreRoot();

    // Initialize the random scale offset once per session
    useEffect(() => {
        if (conditionScaleOffset === null) {
            setConditionScaleOffset(Math.floor(Math.random() * 7));
        }
    }, [conditionScaleOffset, setConditionScaleOffset]);

    const permutedScaleOrder = getPermutedScaleOrder(conditionScaleOffset ?? 0);
    const scaleName = permutedScaleOrder[scaleIndex];
    const scaleDetail = scaleDetails[scaleName];
    const isLastScale = scaleIndex === permutedScaleOrder.length - 1;
    const hasSelection = scaleValues[scaleName] != null;

    const handleScaleTransfer = () => {
        return runtime.dispatch("submitRating", {
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
                            {__("Rate the conversation:")}
                            <br />
                            {__(scaleDetail.displayName)}
                        </>
                    }
                ></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <ComponentScale scaleName={scaleName}></ComponentScale>
                    <p>{__(scaleDetail.description)}</p>
                </div>

                {isLastScale ? (
                    <ComponentFooter onNext={handleScaleTransfer} disabled={!hasSelection}></ComponentFooter>
                ) : (
                    <div className="mt-8 flex flex-none justify-end">
                        <Button onClick={() => setScaleIndex(scaleIndex + 1)} disabled={!hasSelection}>
                            {__("Continue")} <ArrowRight data-icon="inline-end" />
                        </Button>
                    </div>
                )}
            </div>
        </>
    );
}

export default ViewShortConversationTestEvaluation;
