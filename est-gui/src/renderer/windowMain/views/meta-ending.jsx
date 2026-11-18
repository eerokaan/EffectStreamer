import { useTranslate } from "@/lib/helper-languages";
import ComponentHeader from "@/components/header";
import useStoreRoot from "@/stores/root";

function ViewEnding() {
    const __ = useTranslate();
    const { snapshot } = useStoreRoot();
    const completion = snapshot?.viewData?.completion;
    const successful = snapshot?.outcome === "completed";
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline={__("Thank you for taking part")}></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p className="mb-4">{successful ? __("You've completed all the tests!") : __("The session ended early. Any results that were already saved will be kept.")}</p>
                    <p className="mb-4">{__("Thank you for your time and for helping with this study. Your ratings help us understand and improve voice chat quality.")}</p>
                    {completion?.url ? (
                        <>
                            <a className="mb-4 inline-block rounded bg-gray-900 px-4 py-2 text-white" href={completion.url}>
                                {__("Back to Prolific")}
                            </a>
                            <label className="block">
                                {__("Completion code (copy it if the redirect doesn't work):")} <input className="border p-2" readOnly value={completion.code} onFocus={(event) => event.target.select()} />
                            </label>
                        </>
                    ) : (
                        <p className="mb-4">{__("You can now leave the test station. Enjoy the rest of your day!")}</p>
                    )}
                </div>
            </div>
        </>
    );
}

export default ViewEnding;
