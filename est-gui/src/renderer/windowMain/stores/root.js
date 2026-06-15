import createStore from "@/lib/stores-create";

const useStoreRoot = createStore({
    currentView: "viewWaiting",
    showDialog: false,
    conditionScaleOffset: null,
    conditionAsset: null,
    conditionListeningSpeakingTestIndex: null,
    conditionListeningSpeakingTestRole: null
});

export default useStoreRoot;
