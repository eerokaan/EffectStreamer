import storeCreate from "@/lib/store-create";

const useStoreComponentFooter = storeCreate({
    isWaitingForPeer: false,
    isWaitingForUpload: false,
    isWaitingForRecording: false
});

export default useStoreComponentFooter;
