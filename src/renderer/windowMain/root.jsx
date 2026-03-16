import useStoreRoot from "@/stores/root";
import ViewBreak from "@/views/meta-break";
import ViewEnding from "@/views/meta-ending";
import ViewListeningSpeakingTest from "@/views/condition-listening-speaking-test";
import ViewListeningSpeakingTestEvaluation from "@/views/condition-listening-speaking-test-evaluation";
import ViewListeningSpeakingTestExplanation from "@/views/condition-listening-speaking-test-explanation";
import ViewPretest from "@/views/meta-pretest";
import ViewShortConversationTest from "@/views/condition-short-conversation-test";
import ViewShortConversationTestEvaluation from "@/views/condition-short-conversation-test-evaluation";
import ViewShortConversationTestExplanation from "@/views/condition-short-conversation-test-explanation";
import ViewWaiting from "@/views/meta-waiting";
import ViewWelcome from "@/views/meta-welcome";

const viewMap = {
    "viewWaiting": ViewWaiting,
    "viewWelcome": ViewWelcome,
    "viewPretest": ViewPretest,
    "viewShortConversationTestExplanation": ViewShortConversationTestExplanation,
    "viewShortConversationTest": ViewShortConversationTest,
    "viewShortConversationTestEvaluation": ViewShortConversationTestEvaluation,
    "viewListeningSpeakingTestExplanation": ViewListeningSpeakingTestExplanation,
    "viewListeningSpeakingTest": ViewListeningSpeakingTest,
    "viewListeningSpeakingTestEvaluation": ViewListeningSpeakingTestEvaluation,
    "viewBreak": ViewBreak,
    "viewEnding": ViewEnding
};

function Root() {
    const { currentView } = useStoreRoot();
    const View = viewMap[currentView];

    return (
        <>
            <div className="min-h-screen p-12 flex flex-col">
                <View></View>
            </div>
        </>
    );
}

export default Root;