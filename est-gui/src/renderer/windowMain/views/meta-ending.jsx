import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewEnding() {
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Vielen Dank für Ihre Teilnahme"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p>
                        Sie haben alle Tests erfolgreich abgeschlossen!
                        <br />
                        <br />
                        Wir bedanken uns herzlich für Ihre Zeit und Ihre wertvolle Unterstützung bei dieser Studie. Ihre Bewertungen helfen uns maßgeblich dabei, die Qualität von Voicechat-Verbindungen besser zu verstehen und zu optimieren.
                        <br />
                        <br />
                        Sie können nun den Testplatz verlassen. Wir wünschen Ihnen einen schönen restlichen Tag!
                    </p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewEnding;
