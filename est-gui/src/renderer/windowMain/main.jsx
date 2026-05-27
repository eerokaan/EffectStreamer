import "@/assets/css/main.css";
import storesIpcGateway from "@/lib/stores-ipc-gateway";
import ReactDOM from "react-dom/client";
import Root from "./root";

storesIpcGateway();

ReactDOM.createRoot(document.getElementById("root")).render(<Root></Root>);
