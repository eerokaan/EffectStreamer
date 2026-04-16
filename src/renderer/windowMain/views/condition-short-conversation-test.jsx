import { useEffect } from "react";
import { conditionSctImages, resolveImage } from "@/lib/helper-images";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import useStoreRoot from "@/stores/root";

function ViewShortConversationTest() {
    const { conditionImage } = useStoreRoot();
    const imageSrc = resolveImage(conditionSctImages, conditionImage);

    useEffect(() => {
        window.appApi.ipcRenderer.invoke("ipc:coreStartRequest", {
            component: "sender"
        });
        return () => {
            window.appApi.ipcRenderer.invoke("ipc:coreStopRequest", {
                testType: "sct"
            });
        };
    }, []);

    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Short Conversation Test"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <img src={imageSrc} alt="Short Conversation Test" className="block w-full" draggable="false" />
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewShortConversationTest;
