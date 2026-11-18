import { loadStudyAsset, resolveLocalizedImage } from "@/lib/helper-assets";
import { useSessionLanguage, useTranslate } from "@/lib/helper-languages";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewShortConversationTestExplanation() {
    const language = useSessionLanguage();
    const __ = useTranslate();
    const image = loadStudyAsset(() => resolveLocalizedImage("short-conversation-test", "explanation.png", language));

    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline={__("Instructions for the next conversation")} />

                <div className="flex w-full max-w-5xl flex-1 flex-col">
                    {image ? <img src={image} alt={__("Short conversation test instructions")} className="block w-full" draggable="false" /> : <p role="alert">{__("The study material could not be loaded.")}</p>}
                </div>

                <ComponentFooter disabled={!image} />
            </div>
        </>
    );
}

export default ViewShortConversationTestExplanation;
