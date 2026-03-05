import { useState, useEffect } from "react";

import ViewWaiting from "./views/meta-waiting";
import ViewWelcome from "./views/meta-welcome";
import ViewPreTest from "./views/meta-pretest";

// ToDo: Look if there's a framework/library which can refactor this useState/useEffect kind of style
// Shorter code would be nice

function App() {
    const [currentView, setCurrentView] = useState("waiting");

    useEffect(() => {
        window.appApi.ipcRenderer.on("ipc:allClientsConnected", () => {
            setCurrentView("welcome");
        });
    }, []);

    return (
        <>
            <div className="h-screen overflow-hidden">
                {currentView === "waiting" && <ViewWaiting />}
                {currentView === "welcome" && <ViewWelcome />}
                {currentView === "pretest" && <ViewPreTest />}
            </div>
        </>
    );
}

export default App;
