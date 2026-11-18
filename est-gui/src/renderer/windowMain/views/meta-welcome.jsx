import { useTranslate } from "@/lib/helper-languages";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewWelcome() {
    const __ = useTranslate();
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline={__("Welcome to the experiment")}></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p className="mb-4">{__("Welcome to our experiment on voice chat quality!")}</p>
                    <p className="mb-4">{__("Over the next few minutes, you and a partner will try several speaking tasks. The audio quality will vary from one task to the next. Please rate what you actually hear and experience.")}</p>
                    <p className="mb-4">{__("Here's what to expect:")}</p>
                    <ul className="mb-4 inline-block list-inside list-disc">
                        <li>{__("First, we'll ask you a few background questions.")}</li>
                        <li>
                            {__("Then you'll begin the tests, which are divided into several sections.")}
                            <ul className="ml-6 inline-block list-inside list-disc">
                                <li>{__("Before each test, we'll explain in detail what to expect.")}</li>
                                <li>{__("During the test, you'll speak with your partner.")}</li>
                                <li>{__("Afterward, click on the scales to rate your experience.")}</li>
                            </ul>
                        </li>
                        <li>{__("We'll take a short break halfway through.")}</li>
                    </ul>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewWelcome;
