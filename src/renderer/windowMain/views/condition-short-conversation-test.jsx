import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";

function ViewShortConversationTest() {
    return (
        <>
            <div className="flex flex-col flex-1 justify-center">
                <ComponentHeader headline="ShortConversationTest"></ComponentHeader>

                <div className="flex-1">
                    <p>Lorem Ipsum</p>
                </div>

                <ComponentFooter></ComponentFooter>
            </div>
        </>
    );
}

export default ViewShortConversationTest;