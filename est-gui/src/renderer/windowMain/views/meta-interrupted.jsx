import ComponentHeader from "@/components/header";
import { useRuntime } from "@/runtime/context";
import useStoreRoot from "@/stores/root";

export default function ViewInterrupted() {
    const runtime = useRuntime(), { snapshot } = useStoreRoot();
    const recovery = snapshot?.viewData?.recovery;
    return <div className="flex flex-1 flex-col justify-center">
        <ComponentHeader headline="Verbindung unterbrochen" />
        <p className="mb-4">Bitte lassen Sie diese Seite geöffnet. Bereits vorhandene Aufnahmen bleiben bis zur bestätigten Speicherung erhalten.</p>
        <p className="mb-4">{recovery?.kind === "upload" ? "Die Audiodaten werden nach Wiederherstellung der Verbindung weiter übertragen; das Gespräch wird nicht wiederholt." : "Nach erneuter Audioprüfung können Sie mit demselben Partner den unterbrochenen Abschnitt von vorn beginnen."}</p>
        {recovery?.kind !== "upload" && <button className="mb-4 rounded bg-gray-900 p-3 text-white disabled:opacity-50" disabled={snapshot?.setupRequired && !snapshot.setupComplete} onClick={() => runtime.dispatch("ready", { currentView: "viewInterrupted" }).catch(error => runtime.onError?.(error))}>Bereit für erneuten Versuch mit demselben Partner</button>}
        <button className="underline" onClick={() => runtime.dispatch("leave", {}).catch(error => runtime.onError?.(error))}>Sitzung beenden</button>
    </div>;
}
