import "@/assets/css/main.css";
import Root from "./root";
import React from "react";
import ReactDOM from "react-dom/client";
import storesIpcGateway from "@/lib/stores-ipc-gateway";

storesIpcGateway();

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <Root></Root>
    </React.StrictMode>
);
