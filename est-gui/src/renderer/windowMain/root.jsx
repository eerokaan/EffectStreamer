import ComponentDevicePicker from "@/components/devicepicker";
import ViewListeningSpeakingTestEvaluation from "@/views/listening-speaking-test-evaluation";
import ViewListeningSpeakingTestExplanation from "@/views/listening-speaking-test-explanation";
import ViewListeningSpeakingTestMain from "@/views/listening-speaking-test-main";
import ViewBreak from "@/views/meta-break";
import ViewEnding from "@/views/meta-ending";
import ViewPretest from "@/views/meta-pretest";
import ViewWaiting from "@/views/meta-waiting";
import ViewWelcome from "@/views/meta-welcome";
import ViewShortConversationTestEvaluation from "@/views/short-conversation-test-evaluation";
import ViewShortConversationTestExplanation from "@/views/short-conversation-test-explanation";
import ViewShortConversationTestMain from "@/views/short-conversation-test-main";
import useStoreRoot from "@/stores/root";

const viewMap = {
    viewWaiting: ViewWaiting,
    viewWelcome: ViewWelcome,
    viewPretest: ViewPretest,
    viewShortConversationTestExplanation: ViewShortConversationTestExplanation,
    viewShortConversationTestMain: ViewShortConversationTestMain,
    viewShortConversationTestEvaluation: ViewShortConversationTestEvaluation,
    viewListeningSpeakingTestExplanation: ViewListeningSpeakingTestExplanation,
    viewListeningSpeakingTestMain: ViewListeningSpeakingTestMain,
    viewListeningSpeakingTestEvaluation: ViewListeningSpeakingTestEvaluation,
    viewBreak: ViewBreak,
    viewEnding: ViewEnding
};

function Root() {
    const { currentView, runtimeError } = useStoreRoot();
    const View = viewMap[currentView] || ViewWaiting;

    return (
        <>
            <ComponentDevicePicker />
            <div className="flex min-h-screen flex-col p-12">
                {runtimeError && <p role="alert" className="mb-4 text-red-700">{runtimeError}</p>}
                <View></View>
            </div>
        </>
    );
}

export default Root;
