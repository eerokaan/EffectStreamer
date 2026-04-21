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
                        Bevor wir gemeinsam in die Tests starten, bitten wir Sie, ein paar kurze Angaben zu Ihrer Person zu machen.
                        <br />
                        <br />
                        Diese Informationen helfen uns dabei, die Ergebnisse der Studie besser zu verstehen und statistisch einzuordnen. Wir versichern Ihnen, dass Ihre Daten streng vertraulich behandelt werden und ausschließlich für die Zwecke dieser Untersuchung verwendet werden.
                        <br />
                        <br />
                        Bitte nehmen Sie sich einen Moment Zeit, um das folgende Formular auszufüllen, damit wir anschließend direkt mit den Tests beginnen können.
                    </p>

                    <PretestForm ref={formRef} onSubmit={handleFormSubmit} />
                </div>

                <ComponentFooter onNext={handleNext}></ComponentFooter>
            </div>
        </>
    );
}

export default ViewPretest;
