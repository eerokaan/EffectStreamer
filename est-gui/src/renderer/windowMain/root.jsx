import { useTranslate } from "@/lib/helper-languages";
import ComponentDevicePicker from "@/components/devicepicker";
import ViewListeningSpeakingTestEvaluation from "@/views/listening-speaking-test-evaluation";
import ViewListeningSpeakingTestExplanation from "@/views/listening-speaking-test-explanation";
import ViewListeningSpeakingTestMain from "@/views/listening-speaking-test-main";
import ViewBreak from "@/views/meta-break";
import ViewEnding from "@/views/meta-ending";
import ViewInterrupted from "@/views/meta-interrupted";
import ViewPretest from "@/views/meta-pretest";
import ViewWaiting from "@/views/meta-waiting";
import ViewWelcome from "@/views/meta-welcome";
import ViewShortConversationTestEvaluation from "@/views/short-conversation-test-evaluation";
import ViewShortConversationTestExplanation from "@/views/short-conversation-test-explanation";
import ViewShortConversationTestMain from "@/views/short-conversation-test-main";
import useStoreRoot from "@/stores/root";

const viewMap = {
    viewWaiting: ViewWaiting,
    viewInterrupted: ViewInterrupted,
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

export function StudyStartupError() {
    return (
        <div role="alert" className="p-12 text-red-700">
            <p lang="en">Could not connect to the study. Please contact the study organizer.</p>
            <p lang="de">Die Verbindung zur Studie konnte nicht hergestellt werden. Bitte wenden Sie sich an die Studienleitung.</p>
        </div>
    );
}

function Root() {
    const { currentView, runtimeError, sessionLanguage, snapshot } = useStoreRoot();
    const __ = useTranslate();
    const View = viewMap[currentView] || ViewWaiting;

    if (!sessionLanguage) return runtimeError ? <StudyStartupError /> : null;

    return (
        <>
            <ComponentDevicePicker />
            <div className="flex min-h-screen flex-col p-12">
                {runtimeError && (
                    <p role="alert" className="mb-4 text-red-700">
                        {__("Could not complete the study request. Please try again or contact the study organizer.")}
                    </p>
                )}
                {(!runtimeError || snapshot) && <View />}
            </div>
        </>
    );
}

export default Root;
