import storeCreate from "@/lib/store-create";

const useStoreComponentDevicePicker = storeCreate({
    open: false,
    loading: false,
    initialized: false,
    verified: false,
    activeCondition: false,
    sources: [{ id: "default", label: "System / backend default microphone" }],
    sinks: [{ id: "default", label: "System / backend default output" }],
    sourceId: "default",
    sinkId: "default",
    error: null
});

export default useStoreComponentDevicePicker;
