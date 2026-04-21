import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewEnding() {
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Vielen Dank für deine Teilnahme"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p>Lorem Ipsum</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewEnding;
