import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewWelcome() {
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Willkommen beim Experiment"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p className="mb-4">Herzlich willkommen zu unserem Experiment zur Qualität von Voicechat-Verbindungen!</p>
                    <p className="mb-4">In den kommenden Minuten werden Sie gemeinsam mit einem Chatpartner verschiedene Sprachsituationen testen. Dabei wird die Audioqualität – insbesondere in Bezug auf die Lautstärke und mögliche Echos – variieren. Ihre Aufgabe ist es, diese Eindrücke ehrlich zu bewerten.</p>
                    <p className="mb-4">Der Ablauf gestaltet sich wie folgt:</p>
                    <ul className="mb-4 inline-block list-inside list-disc">
                        <li>Zunächst erfassen wir einige allgemeine Basisinformationen.</li>
                        <li>
                            Anschließend folgen die Tests, die in mehrere Abschnitte unterteilt sind.
                            <ul className="ml-6 inline-block list-inside list-disc">
                                <li>Vor jedem Test erhalten Sie detaillierte Informationen was Sie erwarten wird.</li>
                                <li>Danach startet der eigentliche Test. Hier sprechen Sie mit Ihrem Chatpartner.</li>
                                <li>Anschließend bewerten Sie Ihre Eindrücke. Klicken Sie hierfür die Skalen an.</li>
                            </ul>
                        </li>
                        <li>Nach der Hälfte der Tests legen wir eine kurze Pause zum Verschnaufen ein.</li>
                    </ul>
                    <p className="mb-4">Danke für Ihre Teilnahme. Wir freuen uns sehr über Ihre Unterstützung!</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewWelcome;
