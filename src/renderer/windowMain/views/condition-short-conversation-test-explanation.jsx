import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import explanationImage from "@/assets/img/condition-short-conversation-test/explanation.png";

function ViewShortConversationTestExplanation() {
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Short Conversation Test: Explanation"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <img src={explanationImage} alt="Short Conversation Test Explanation" className="block w-full" draggable="false" />
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewShortConversationTestExplanation;
