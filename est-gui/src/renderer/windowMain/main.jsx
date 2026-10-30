import ReactDOM from "react-dom/client";
import { createRuntime } from "@runtime-platform";
import { RuntimeProvider } from "@/runtime/context";
import { connectRuntimeStores } from "@/runtime/store-gateway";
import Root from "@/root";
import "@/assets/css/main.css";

const runtime = createRuntime();
connectRuntimeStores(runtime);
void runtime.bootstrap().catch(error => runtime.onError(error));

ReactDOM.createRoot(document.getElementById("root")).render(<RuntimeProvider runtime={runtime}><Root /></RuntimeProvider>);
