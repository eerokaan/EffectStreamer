import { conditionSctExplanationAssets, resolveAsset } from "@/lib/helper-assets";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewShortConversationTestExplanation() {
    const asset = resolveAsset(conditionSctExplanationAssets, "explanation.png");

    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Erklärung des folgenden Gesprächs"></ComponentHeader>

                <div className="flex w-full max-w-5xl flex-1 flex-col">
                    {asset?.type === "html" && <iframe src={asset.src} className="w-full flex-1 border-none" title="Test Document" />}
                    {asset?.type === "image" && <img src={asset.src} alt="Test Asset" className="block w-full" draggable="false" />}
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewShortConversationTestExplanation;
