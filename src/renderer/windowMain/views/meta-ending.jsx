import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewEnding() {
    return (
        <>
            <div className="flex flex-col flex-1 justify-center">
                <ComponentHeader headline="The End"></ComponentHeader>

                <div className="flex-1">
                    <p>🎵 This is the end. My only friend... The end. 🎵</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewEnding;
