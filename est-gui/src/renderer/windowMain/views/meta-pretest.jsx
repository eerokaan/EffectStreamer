import { useRef } from "react";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import PretestForm from "@/components/pretest-form";
import useStoreRoot from "@/stores/root";

function ViewPretest() {
    const { currentView } = useStoreRoot();
    const formRef = useRef(null);

    const handleFormSubmit = async (data) => {
        window.appApi.ipcRenderer.invoke("ipc:pretestSubmitRequest", {
            formData: data
        });
        window.appApi.ipcRenderer.invoke("ipc:viewChangeRequest", {
            currentView
        });
    };

    const handleNext = async () => {
        if (formRef.current) {
            return await formRef.current.submit();
        }
        return false;
    };

    return (
        <>
            <div className="flex flex-1 flex-col justify-center">
                <ComponentHeader headline="Bevor es losgeht"></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p className="mb-4">
                        Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod
                        tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.
                    </p>

                    <PretestForm ref={formRef} onSubmit={handleFormSubmit} />
                </div>

                <ComponentFooter onNext={handleNext}></ComponentFooter>
            </div>
        </>
    );
}

export default ViewPretest;
