import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewPretest() {
    return (
        <>
            <div className="flex flex-col flex-1 justify-center">
                <ComponentHeader headline="Pretest Questions"></ComponentHeader>

                <div className="flex-1">
                    <p>Yeah... This is where the content for the Pretest Questions comes.</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewPretest;