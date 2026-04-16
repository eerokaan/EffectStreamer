import { conditionLstExplanationImages, resolveImage } from "@/lib/helper-images";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewListeningSpeakingTestExplanation() {
    const imageSrc = resolveImage(conditionLstExplanationImages, "explanation.png");

    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Listening/Speaking Test: Explanation"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <img src={imageSrc} alt="Listening/Speaking Test Explanation" className="block w-full" draggable="false" />
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewListeningSpeakingTestExplanation;
