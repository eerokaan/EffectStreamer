import "@/assets/css/main.css";
import ReactDOM from "react-dom/client";
import storesIpcGateway from "@/lib/stores-ipc-gateway";
import Root from "./root";

storesIpcGateway();

ReactDOM.createRoot(document.getElementById("root")).render(<Root></Root>);
