import createStore from "@/lib/stores-create";

const useStoreComponentFooter = createStore({
    isWaitingForPeer: false,
    isWaitingForUpload: false
});

export default useStoreComponentFooter;
