import { useEffect } from "react";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import useStoreRoot from "@/stores/root";

const conditionImages = import.meta.glob(
    "@/assets/img/condition-listening-speaking-test/client_*/*.png",
    { eager: true, import: "default" }
);

function ViewListeningSpeakingTest() {
    const { conditionImage } = useStoreRoot();

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

    const imageSrc = conditionImage
        ? conditionImages[Object.keys(conditionImages).find(key => key.endsWith(conditionImage))]
        : null;

    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Listening/Speaking Test"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    {imageSrc && <img src={imageSrc} alt="Listening/Speaking Test" className="block w-full" draggable="false" />}
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewListeningSpeakingTest;
