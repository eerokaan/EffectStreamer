import { initializeAudioSessionControl } from "@/lib/helper-webrtc";
import ReactDOM from "react-dom/client";
import storeIpcGateway from "@/lib/store-ipc-gateway";
import Root from "@/root";
import "@/assets/css/main.css";

storeIpcGateway();
initializeAudioSessionControl();

ReactDOM.createRoot(document.getElementById("root")).render(<Root></Root>);
