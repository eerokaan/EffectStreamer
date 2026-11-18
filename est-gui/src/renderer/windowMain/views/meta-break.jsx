import { useTranslate } from "@/lib/helper-languages";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewBreak() {
    const __ = useTranslate();
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline={__("Time for a break")}></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p className="mb-4">{__("Well done! You've finished the first half of the tests.")}</p>
                    <p className="mb-4">{__("Please take a five-minute break. Feel free to step away, stretch, or just relax for a moment.")}</p>
                    <p className="mb-4">{__("Enjoy the break. We'll continue the tests together when the time is up.")}</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewBreak;
