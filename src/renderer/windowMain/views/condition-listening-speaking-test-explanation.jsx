import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import explanationImage from "@/assets/img/condition-listening-speaking-test/explanation.png";

function ViewListeningSpeakingTestExplanation() {
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Listening/Speaking Test: Explanation"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <img src={explanationImage} alt="Listening/Speaking Test Explanation" className="block w-full" draggable="false" />
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewListeningSpeakingTestExplanation;
