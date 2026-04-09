import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import ComponentScale from "@/components/scale";

function ViewShortConversationTestEvaluation() {
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="ShortConversationTest Evaluation [3]"></ComponentHeader>

                <div className="flex-1">
                    <ComponentScale scaleName="audio_quality"></ComponentScale>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewShortConversationTestEvaluation;
