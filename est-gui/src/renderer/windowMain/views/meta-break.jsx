import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewBreak() {
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Zeit für eine Pause"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p>Lorem Ipsum</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewBreak;
