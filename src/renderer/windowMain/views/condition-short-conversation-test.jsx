import { useEffect } from "react";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewShortConversationTest() {
    useEffect(() => {
        window.appApi.ipcRenderer.invoke("ipc:coreStartRequest");
        return () => {
            window.appApi.ipcRenderer.invoke("ipc:coreStopRequest");
        };
    }, []);

    return (
        <>
            <div className="flex flex-col flex-1 justify-center">
                <ComponentHeader headline="ShortConversationTest [2]"></ComponentHeader>

                <div className="flex-1">
                    <p><code>est-core</code> now running in background</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewShortConversationTest;