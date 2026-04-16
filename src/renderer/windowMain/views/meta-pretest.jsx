import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewPretest() {
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Bevor es losgeht"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p>Lorem Ipsum</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewPretest;
