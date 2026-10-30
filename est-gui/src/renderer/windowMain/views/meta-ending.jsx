import ComponentHeader from "@/components/header";
import useStoreRoot from "@/stores/root";

function ViewEnding() {
    const { snapshot } = useStoreRoot();
    const completion = snapshot?.viewData?.completion;
    const successful = snapshot?.outcome === "completed";
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Vielen Dank für Ihre Teilnahme"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p className="mb-4">{successful ? "Sie haben alle Tests erfolgreich abgeschlossen!" : "Die Sitzung wurde vorzeitig beendet. Bereits gespeicherte Ergebnisse bleiben erhalten."}</p>
                    <p className="mb-4">Wir bedanken uns herzlich für Ihre Zeit und Ihre wertvolle Unterstützung bei dieser Studie. Ihre Bewertungen helfen uns maßgeblich dabei, die Qualität von Voicechat-Verbindungen besser zu verstehen und zu optimieren.</p>
                    {completion?.url ? <>
                        <a className="mb-4 inline-block rounded bg-gray-900 px-4 py-2 text-white" href={completion.url}>Zurück zu Prolific</a>
                        <label className="block">Abschlusscode (zum Kopieren, falls die Weiterleitung nicht funktioniert): <input className="border p-2" readOnly value={completion.code} onFocus={event => event.target.select()} /></label>
                    </> : <p className="mb-4">Sie können nun den Testplatz verlassen. Wir wünschen Ihnen einen schönen restlichen Tag!</p>}
                </div>
            </div>
        </>
    );
}

export default ViewEnding;
