import storeCreate from "@/lib/store-create";

const useStoreRoot = storeCreate({
    currentView: "viewWaiting",
    snapshot: null,
    runtimeError: null,
    sessionLanguage: null,
    showDialog: false,
    pretestForm: null,
    conditionAsset: null,
    conditionScaleOffset: null,
    conditionListeningSpeakingTestIndex: null,
    conditionListeningSpeakingTestRole: null
});

export default useStoreRoot;
