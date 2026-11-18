import { useRef } from "react";
import { useTranslate } from "@/lib/helper-languages";
import { useRuntime } from "@/runtime/context";
import ComponentFooter from "@/components/footer";
import ComponentHeader from "@/components/header";
import ComponentPretestForm from "@/components/pretestform";
import useStoreRoot from "@/stores/root";

function ViewPretest() {
    const __ = useTranslate();
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
                <ComponentHeader headline={__("Before we begin")}></ComponentHeader>

                <div className="max-w-5xl flex-1">
                    <p className="mb-4">{__("Before we start the tests, we'd like to ask you a few questions about yourself.")}</p>
                    <p className="mb-4">{__("Your answers help us interpret the study results and inform our statistical analysis.")}</p>
                    <p className="mb-6">{__("Please take a moment to fill out the form below. Then we can start the tests.")}</p>

                    <ComponentPretestForm key={pretestFormKey} ref={formRef} pretestForm={pretestForm} onSubmit={handleFormSubmit} />
                </div>

                <ComponentFooter onNext={handleNext}></ComponentFooter>
            </div>
        </>
    );
}

export default ViewPretest;
