import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewPretest() {
    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="A little bit about you"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p>Yeah... This is where the content for the Pretest Questions comes.</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewPretest;
