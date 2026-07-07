import storeCreate from "@/lib/store-create";

const useStoreRoot = storeCreate({
    currentView: "viewWaiting",
    showDialog: false,
    pretestForm: null,
    conditionAsset: null,
    conditionScaleOffset: null,
    conditionListeningSpeakingTestIndex: null,
    conditionListeningSpeakingTestRole: null
});

export default useStoreRoot;
