import { useRuntime } from "@/runtime/context";
import useStoreRoot from "@/stores/root";

function ViewWaiting() {
    const runtime = useRuntime(), { snapshot } = useStoreRoot();
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <h1 className="text-center text-4xl font-semibold text-gray-700">Das Experiment beginnt bald...</h1>
                {snapshot?.phase === "waiting" && <><p className="mt-4 text-center">Wir suchen einen Partner mit abgeschlossener Vorbereitung. Bitte lassen Sie diese Seite geöffnet.</p>
                    <button className="mt-4 underline" onClick={() => runtime.dispatch("leave", {}).catch(error => runtime.onError?.(error))}>Wartebereich verlassen</button></>}
            </div>
        </>
    );
}

export default ViewWaiting;
