import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewBreak() {
    return (
        <>
            <div className="flex flex-col flex-1 justify-center">
                <ComponentHeader headline="Break"></ComponentHeader>

                <div className="flex-1">
                    <p>Now it is time for a break.</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewBreak;
