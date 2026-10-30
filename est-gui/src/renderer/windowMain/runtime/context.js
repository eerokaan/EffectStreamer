import { createContext, createElement, useContext } from "react";
const Context = createContext(null);
export function RuntimeProvider({ runtime, children }) { return createElement(Context.Provider, { value: runtime }, children); }
export function useRuntime() { const runtime = useContext(Context); if (!runtime) throw new Error("RuntimeProvider is missing"); return runtime; }
