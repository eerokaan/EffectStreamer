import { useRef } from "react";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import ComponentPretestForm from "@/components/pretestform";
import useStoreRoot from "@/stores/root";
import { useRuntime } from "@/runtime/context";

function ViewPretest() {
    const runtime = useRuntime();
    const { currentView, pretestForm } = useStoreRoot();
    const formRef = useRef(null);
    const pretestFormKey = JSON.stringify(pretestForm ?? []);

    const handleFormSubmit = async (data) => {
        await runtime.dispatch("pretest", {
            formData: data
        });
        await runtime.dispatch("nextView", {
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
                    <p className="mb-4">Bevor wir gemeinsam in die Tests starten, bitten wir Sie, ein paar kurze Angaben zu Ihrer Person zu machen.</p>
                    <p className="mb-4">Diese Informationen helfen uns dabei, die Ergebnisse der Studie besser zu verstehen und statistisch einzuordnen.</p>
                    <p className="mb-6">Bitte nehmen Sie sich einen Moment Zeit, um das folgende Formular auszufüllen, damit wir anschließend direkt mit den Tests beginnen können.</p>

                    <ComponentPretestForm key={pretestFormKey} ref={formRef} pretestForm={pretestForm} onSubmit={handleFormSubmit} />
                </div>

                <ComponentFooter onNext={handleNext}></ComponentFooter>
            </div>
        </>
    );
}

export default ViewPretest;
