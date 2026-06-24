import createStore from "@/lib/stores-create";

const useStoreRoot = createStore({
    currentView: "viewWaiting",
    showDialog: false,
    pretestForm: null,
    conditionAsset: null,
    conditionScaleOffset: null,
    conditionListeningSpeakingTestIndex: null,
    conditionListeningSpeakingTestRole: null
});

export default useStoreRoot;
