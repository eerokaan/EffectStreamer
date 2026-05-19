import ViewListeningSpeakingTest from "@/views/listening-speaking-test";
import ViewListeningSpeakingTestEvaluation from "@/views/listening-speaking-test-evaluation";
import ViewListeningSpeakingTestExplanation from "@/views/listening-speaking-test-explanation";
import ViewShortConversationTest from "@/views/short-conversation-test";
import ViewShortConversationTestEvaluation from "@/views/short-conversation-test-evaluation";
import ViewShortConversationTestExplanation from "@/views/short-conversation-test-explanation";
import ViewBreak from "@/views/meta-break";
import ViewEnding from "@/views/meta-ending";
import ViewPretest from "@/views/meta-pretest";
import ViewWaiting from "@/views/meta-waiting";
import ViewWelcome from "@/views/meta-welcome";
import useStoreRoot from "@/stores/root";

const viewMap = {
    viewWaiting: ViewWaiting,
    viewWelcome: ViewWelcome,
    viewPretest: ViewPretest,
    viewShortConversationTestExplanation: ViewShortConversationTestExplanation,
    viewShortConversationTest: ViewShortConversationTest,
    viewShortConversationTestEvaluation: ViewShortConversationTestEvaluation,
    viewListeningSpeakingTestExplanation: ViewListeningSpeakingTestExplanation,
    viewListeningSpeakingTest: ViewListeningSpeakingTest,
    viewListeningSpeakingTestEvaluation: ViewListeningSpeakingTestEvaluation,
    viewBreak: ViewBreak,
    viewEnding: ViewEnding
};

function Root() {
    const { currentView } = useStoreRoot();
    const View = viewMap[currentView];

    return (
        <>
            <div className="flex min-h-screen flex-col p-12">
                <View></View>
            </div>
        </>
    );
}

export default Root;
