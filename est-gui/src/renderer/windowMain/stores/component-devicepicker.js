import storeCreate from "@/lib/store-create";

const useStoreComponentDevicePicker = storeCreate({
    open: false,
    loading: false,
    initialized: false,
    verified: false,
    activeCondition: false,
    sources: [],
    sinks: [],
    sourceId: "",
    sinkId: "",
    error: null
});

export default useStoreComponentDevicePicker;
