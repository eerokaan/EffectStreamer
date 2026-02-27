import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import useStoreDummy from "@/stores/l1_Dummy";
import useStoreSectionBody from "@/stores/l0_SectionBody";


function Dummy() {
    const { inputText, updateStates: updateStatesDummy } = useStoreDummy();
    const { updateStates: updateStatesSectionBody } = useStoreSectionBody();

    return (
        <>
            <div className="mb-4">
                <Field>
                    <FieldLabel htmlFor="input-dummy">Dummy Label</FieldLabel>
                    <Input id="input-dummy" type="text" placeholder="Placeholder" value={inputText} onChange={(event) => updateStatesDummy({ inputText: event.target.value })} />
                    <FieldDescription>This is a nice description.</FieldDescription>
                </Field>
            </div>

            <div className="mb-4">
                <Button onClick={(event) => updateStatesSectionBody({ dialogOpen: true })}>Trigger Dialog</Button>
            </div>
        </>
    );
}

export default Dummy;
