import { forwardRef, useImperativeHandle, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { buildPretestFormSchema } from "@/lib/helper-form-schema";
import { translateConfiguredText, useTranslate } from "@/lib/helper-languages";
import { zodResolver } from "@hookform/resolvers/zod";
import useStoreComponentPretestForm from "@/stores/component-pretestform";

const layoutWidthClassNames = {
    1: "col-span-1",
    2: "col-span-2",
    3: "col-span-3",
    4: "col-span-4",
    5: "col-span-5",
    6: "col-span-6",
    7: "col-span-7",
    8: "col-span-8",
    9: "col-span-9",
    10: "col-span-10",
    11: "col-span-11",
    12: "col-span-12"
};

function helperRenderField(fieldConfig, { field, fieldState }) {
    if (fieldConfig.type === "input") {
        return helperRenderInputField(fieldConfig, field, fieldState);
    }
    if (fieldConfig.type === "select") {
        return helperRenderSelectField(fieldConfig, field, fieldState);
    }
    if (fieldConfig.type === "slider") {
        return helperRenderSliderField(fieldConfig, field, fieldState);
    }
    if (fieldConfig.type === "switch") {
        return helperRenderSwitchField(fieldConfig, field, fieldState);
    }
    return null;
}

function helperRenderInputField(fieldConfig, field, fieldState) {
    return (
        <Field data-invalid={fieldState.invalid} className={helperGetFieldClassName(fieldConfig, "gap-1")}>
            <FieldLabel htmlFor={fieldConfig.name}>{fieldConfig.label}</FieldLabel>
            <Input
                {...field}
                id={fieldConfig.name}
                type={fieldConfig.inputType ?? "text"}
                value={field.value ?? ""}
                onChange={(event) => {
                    field.onChange(event.target.value);
                }}
                placeholder={fieldConfig.placeholder}
            />
            {fieldConfig.description && <FieldDescription>{fieldConfig.description}</FieldDescription>}
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
    );
}

function helperRenderSelectField(fieldConfig, field, fieldState) {
    return (
        <Field data-invalid={fieldState.invalid} className={helperGetFieldClassName(fieldConfig, "gap-1")}>
            <FieldLabel htmlFor={fieldConfig.name}>{fieldConfig.label}</FieldLabel>
            <Select value={field.value ?? ""} onValueChange={field.onChange}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder={fieldConfig.placeholder} />
                </SelectTrigger>
                <SelectContent>
                    {fieldConfig.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {fieldConfig.description && <FieldDescription>{fieldConfig.description}</FieldDescription>}
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
    );
}

function helperRenderSliderField(fieldConfig, field, fieldState) {
    const min = fieldConfig.validation.min;
    const max = fieldConfig.validation.max;
    const step = fieldConfig.validation.step;
    const marks = fieldConfig.marks;
    const value = Array.isArray(field.value) ? field.value : [field.value ?? fieldConfig.defaultValue ?? helperGetSliderDefaultValue(min, max, step)];

    return (
        <Field data-invalid={fieldState.invalid} className={helperGetFieldClassName(fieldConfig)}>
            <FieldLabel htmlFor={fieldConfig.name}>{fieldConfig.label}</FieldLabel>
            {fieldConfig.description && <FieldDescription>{fieldConfig.description}</FieldDescription>}
            <Slider id={fieldConfig.name} value={value} onValueChange={(newValue) => field.onChange(newValue[0])} min={min} max={max} step={step} />
            {marks && (marks.minLabel || marks.maxLabel) && (
                <div className="flex justify-between">
                    <span className="text-sm whitespace-nowrap text-muted-foreground">{marks.minLabel}</span>
                    <span className="text-sm whitespace-nowrap text-muted-foreground">{marks.maxLabel}</span>
                </div>
            )}
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
    );
}

function helperRenderSwitchField(fieldConfig, field, fieldState) {
    return (
        <Field orientation="horizontal" data-invalid={fieldState.invalid} className={helperGetFieldClassName(fieldConfig)}>
            <FieldContent>
                <FieldLabel htmlFor={fieldConfig.name}>{fieldConfig.label}</FieldLabel>
                {fieldConfig.description && <FieldDescription>{fieldConfig.description}</FieldDescription>}
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </FieldContent>
            <Switch id={fieldConfig.name} checked={field.value ?? false} onCheckedChange={field.onChange} />
        </Field>
    );
}

function helperGetFieldClassName(fieldConfig, additionalClassName = "") {
    const layoutWidth = fieldConfig.layoutWidth ?? 12;
    return [layoutWidthClassNames[layoutWidth] ?? layoutWidthClassNames[12], additionalClassName].filter(Boolean).join(" ");
}

function helperBuildDefaultValues(fields) {
    return fields.reduce((defaultValues, field) => {
        if (field.type === "input") {
            defaultValues[field.name] = field.defaultValue == null ? "" : String(field.defaultValue);
        }
        else if (field.type === "select") {
            defaultValues[field.name] = field.defaultValue ?? "";
        }
        else if (field.type === "slider") {
            const min = field.validation.min;
            const max = field.validation.max;
            const step = field.validation.step;
            defaultValues[field.name] = field.defaultValue ?? helperGetSliderDefaultValue(min, max, step);
        }
        else if (field.type === "switch") {
            defaultValues[field.name] = field.defaultValue ?? false;
        }

        return defaultValues;
    }, {});
}

function helperGetSliderDefaultValue(min, max, step) {
    const stepCount = Math.floor((max - min) / step);
    return min + Math.floor(stepCount / 2) * step;
}

const ComponentPretestForm = forwardRef(function ComponentPretestForm({ pretestForm, onSubmit }, ref) {
    const __ = useTranslate();
    const fields = useMemo(() => {
        const display = (text) => (text ? translateConfiguredText(text, __) : undefined);
        return Array.isArray(pretestForm)
            ? pretestForm.map((field) => ({
                  ...field,
                  label: display(field.label),
                  description: display(field.description),
                  placeholder: display(field.placeholder) ?? (field.type === "select" ? __("Please select an option.") : undefined),
                  ...(field.options && { options: field.options.map((option) => ({ ...option, label: display(option.label) })) }),
                  ...(field.marks && {
                      marks: {
                          minLabel: display(field.marks.minLabel),
                          maxLabel: display(field.marks.maxLabel)
                      }
                  })
              }))
            : [];
    }, [pretestForm, __]);
    const defaultValues = useMemo(() => helperBuildDefaultValues(fields), [fields]);
    const formSchema = useMemo(() => buildPretestFormSchema(fields, __), [fields, __]);
    const form = useForm({ resolver: zodResolver(formSchema), defaultValues, shouldUnregister: true });
    const { setFormData } = useStoreComponentPretestForm();

    const handleValidSubmit = async (data) => {
        setFormData(data);
        await onSubmit(data);
    };

    useImperativeHandle(ref, () => ({
        submit: async () => {
            if (fields.length === 0) return false;
            let isSuccess = false;

            await form.handleSubmit(
                async (data) => {
                    await handleValidSubmit(data);
                    isSuccess = true;
                },
                () => {
                    isSuccess = false;
                }
            )();

            return isSuccess;
        }
    }));

    return (
        <form onSubmit={(event) => event.preventDefault()} className="w-full rounded-md border p-8">
            <FieldGroup className="grid grid-cols-12 gap-x-4 gap-y-6">
                {fields.map((fieldConfig) => (
                    <Controller key={fieldConfig.name} name={fieldConfig.name} control={form.control} render={(props) => helperRenderField(fieldConfig, props)} />
                ))}
            </FieldGroup>
        </form>
    );
});

export default ComponentPretestForm;
