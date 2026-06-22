import ReactDOM from "react-dom/client";
import storesIpcGateway from "@/lib/stores-ipc-gateway";
import Root from "@/root";
import "@/assets/css/main.css";

storesIpcGateway();

ReactDOM.createRoot(document.getElementById("root")).render(<Root></Root>);
