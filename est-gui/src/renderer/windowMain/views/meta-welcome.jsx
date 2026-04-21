import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewWelcome() {
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Willkommen beim Experiment"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p>
                        Herzlich willkommen zu unserem Experiment zur Qualität von Voicechat-Verbindungen!
                        <br />
                        <br />
                        In den kommenden Minuten werden Sie gemeinsam mit einem Chatpartner verschiedene Sprachsituationen testen. Dabei wird die Audioqualität – insbesondere in Bezug auf die Lautstärke und mögliche Echos – variieren. Ihre Aufgabe ist es, diese Eindrücke ehrlich zu bewerten.
                        <br />
                        <br />
                        Der Ablauf gestaltet sich wie folgt:
                    </p>
                    <ul className="my-4 inline-block list-inside list-disc text-left">
                        <li>Zunächst erfassen wir einige allgemeine Basisinformationen.</li>
                        <li>Anschließend folgen die Tests, die in mehrere Abschnitte unterteilt sind.</li>
                        <li>Nach der Hälfte der Tests legen wir eine kurze Pause ein, um kurz verschnaufen zu können.</li>
                    </ul>
                    <p>Vor jedem einzelnen Testabschnitt erhalten Sie noch einmal detaillierte Informationen zum jeweiligen Ablauf. Wir freuen uns sehr über Ihre Unterstützung!</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewWelcome;
