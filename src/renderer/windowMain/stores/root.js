import createStore from "@/lib/stores-create";

const useStoreRoot = createStore({
    currentView: "viewWaiting",
    scaleOffset: null
});

export default useStoreRoot;
