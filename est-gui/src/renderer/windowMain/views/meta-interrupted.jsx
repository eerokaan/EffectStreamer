import { useTranslate } from "@/lib/helper-languages";
import { useRuntime } from "@/runtime/context";
import ComponentHeader from "@/components/header";
import useStoreRoot from "@/stores/root";

export default function ViewInterrupted() {
    const __ = useTranslate();
    const runtime = useRuntime(),
        { snapshot } = useStoreRoot();
    const recovery = snapshot?.viewData?.recovery;
    return (
        <div className="flex flex-1 flex-col justify-center">
            <ComponentHeader headline={__("Connection interrupted")} />
            <p className="mb-4">{__("Please keep this page open. Your recordings will be kept until we confirm they've been saved.")}</p>
            <p className="mb-4">{recovery?.kind === "upload" ? __("The audio upload will resume when the connection returns. You won't need to repeat the conversation.") : __("After checking your audio again, you can restart the interrupted section with the same partner.")}</p>
            {recovery?.kind !== "upload" && (
                <button className="mb-4 rounded bg-gray-900 p-3 text-white disabled:opacity-50" disabled={snapshot?.setupRequired && !snapshot.setupComplete} onClick={() => runtime.dispatch("ready", { currentView: "viewInterrupted" }).catch((error) => runtime.onError?.(error))}>
                    {__("Ready to try again with the same partner")}
                </button>
            )}
            <button className="underline" onClick={() => runtime.dispatch("leave", {}).catch((error) => runtime.onError?.(error))}>
                {__("End session")}
            </button>
        </div>
    );
}
