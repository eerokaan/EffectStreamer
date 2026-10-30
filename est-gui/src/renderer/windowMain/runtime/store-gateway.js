import useStoreRoot from "@/stores/root";
import useStoreComponentFooter from "@/stores/component-footer";
import useStoreComponentScale from "@/stores/component-scale";
import useStoreComponentDevicePicker from "@/stores/component-devicepicker";

export function connectRuntimeStores(runtime) {
    let previous;
    runtime.onError = error => useStoreRoot.setState({ runtimeError: error.message });
    return runtime.subscribe(snapshot => {
        const changedView = previous?.currentView !== snapshot.currentView;
        const repeatedNotice = !changedView && previous?.viewData?.showDialog === true &&
            previous.viewData.conditionListeningSpeakingTestIndex === snapshot.viewData?.conditionListeningSpeakingTestIndex;
        const showDialog = snapshot.viewData?.showDialog === true && (!repeatedNotice || useStoreRoot.getState().showDialog);
        useStoreRoot.setState({ ...snapshot.viewData, showDialog, currentView: snapshot.currentView, snapshot, runtimeError: null });
        if (changedView) {
            useStoreComponentFooter.getState().resetStates();
            useStoreComponentScale.getState().resetStates();
        }
        const status = snapshot.viewData?.recordingStatus;
        useStoreComponentFooter.setState({ isWaitingForUpload: ["stopping", "uploading"].includes(status), isWaitingForRecording: ["startingSender", "startingReceiver", "startingMedia"].includes(status) });
        useStoreComponentDevicePicker.setState({ activeCondition: ["startingSender", "startingReceiver", "startingMedia", "running", "stopping"].includes(status), verified: snapshot.setupComplete });
        previous = snapshot;
    });
}
