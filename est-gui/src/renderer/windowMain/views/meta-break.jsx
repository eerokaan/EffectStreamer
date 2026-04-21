import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewBreak() {
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Zeit für eine Pause"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p className="mb-4">Herzlichen Glückwunsch, Sie haben die erste Hälfte der Tests hinter sich gebracht!</p>
                    <p className="mb-4">Nun ist es Zeit für eine kurze Verschnaufpause. Bitte gönnen Sie sich eine Auszeit von 5 Minuten. Sie dürfen den Testplatz gerne verlassen, sich kurz bewegen oder einfach einen Moment entspannen.</p>
                    <p className="mb-4">Wir laden Sie ein, die Pause zu genießen – wir setzen die Tests gemeinsam fort, sobald die Zeit abgelaufen ist.</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewBreak;
