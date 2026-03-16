import "@/assets/css/main.css";
import React from "react";
import ReactDOM from "react-dom/client";
import Root from "./root";
import storesIpcGateway from "@/lib/stores-ipc-gateway";

storesIpcGateway();

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <Root></Root>
    </React.StrictMode>
);
