import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewBreak() {
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Time for a break"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p>Now it is time for a break.</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewBreak;
