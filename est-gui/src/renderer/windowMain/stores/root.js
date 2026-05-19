import createStore from "@/lib/stores-create";

const useStoreRoot = createStore({
    currentView: "viewWaiting",
    showDialog: false,
    conditionScaleOffset: null,
    conditionAsset: null,
    conditionListeningSpeakingTestIndex: null,
    lstRole: null
});

export default useStoreRoot;
