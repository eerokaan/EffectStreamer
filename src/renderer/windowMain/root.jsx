import ViewWaiting from "@/views/meta-waiting";
import ViewWelcome from "@/views/meta-welcome";
import ViewPreTest from "@/views/meta-pretest";
import useStoreRoot from "@/stores/root";

const viewMap = {
    "viewWaiting": ViewWaiting,
    "viewWelcome": ViewWelcome,
    "viewPreTest": ViewPreTest,
};

function Root() {
    const { currentView } = useStoreRoot();
    const View = viewMap[currentView];

    return (
        <>
            <div className="min-h-screen p-12 flex flex-col">
                <View></View>
            </div>
        </>
    );
}

export default Root;