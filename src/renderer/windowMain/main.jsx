import "./assets/css/main.css";
import App from "./App";
import React from "react";
import ReactDOM from "react-dom/client";
import zustandStores from "./lib/zustandStores";

zustandStores();

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
