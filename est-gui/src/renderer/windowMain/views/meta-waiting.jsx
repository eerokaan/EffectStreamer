import { useTranslate } from "@/lib/helper-languages";
import { useRuntime } from "@/runtime/context";
import useStoreRoot from "@/stores/root";

function ViewWaiting() {
    const __ = useTranslate();
    const runtime = useRuntime(),
        { snapshot } = useStoreRoot();
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <h1 className="text-center text-4xl font-semibold text-gray-700">{__("The experiment will start soon…")}</h1>
                {snapshot?.phase === "waiting" && (
                    <>
                        <p className="mt-4 text-center">{__("We're looking for a partner who's finished setup. Please keep this page open.")}</p>
                        <button className="mt-4 underline" onClick={() => runtime.dispatch("leave", {}).catch((error) => runtime.onError?.(error))}>
                            {__("Leave the waiting room")}
                        </button>
                    </>
                )}
            </div>
        </>
    );
}

export default ViewWaiting;
