import ReactDOM from "react-dom/client";
import { createRuntime } from "@runtime-platform";
import { RuntimeProvider } from "@/runtime/context";
import { connectRuntimeStores } from "@/runtime/store-gateway";
import Root, { StudyStartupError } from "@/root";
import "@/assets/css/main.css";

const root = ReactDOM.createRoot(document.getElementById("root"));
try {
    const runtime = createRuntime();
    connectRuntimeStores(runtime);
    root.render(<RuntimeProvider runtime={runtime}><Root /></RuntimeProvider>);
    void runtime.bootstrap().catch(error => runtime.onError(error));
} catch (error) {
    console.error(error);
    root.render(<StudyStartupError />);
}
