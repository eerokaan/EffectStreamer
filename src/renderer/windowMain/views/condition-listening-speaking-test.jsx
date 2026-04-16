import { useEffect } from "react";
import { conditionLstImages, resolveImage } from "@/lib/helper-images";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import useStoreRoot from "@/stores/root";

function ViewListeningSpeakingTest() {
    const { conditionImage } = useStoreRoot();
    const imageSrc = resolveImage(conditionLstImages, conditionImage);

    useEffect(() => {
        window.appApi.ipcRenderer.invoke("ipc:coreStartRequest", {
            component: "sender"
        });
        return () => {
            window.appApi.ipcRenderer.invoke("ipc:coreStopRequest", {
                testType: "lst"
            });
        };
    }, []);

    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Listening/Speaking Test"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <img src={imageSrc} alt="Listening/Speaking Test" className="block w-full" draggable="false" />
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewListeningSpeakingTest;
