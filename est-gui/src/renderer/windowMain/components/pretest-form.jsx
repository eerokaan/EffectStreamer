import { forwardRef, useImperativeHandle } from "react";
import { Controller, useForm } from "react-hook-form";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { formSchema } from "@/lib/helper-form-schema";
import { zodResolver } from "@hookform/resolvers/zod";
import useStoreComponentPretestForm from "@/stores/component-pretest-form";

const PretestForm = forwardRef(({ onSubmit }, ref) => {
    const form = useForm({ resolver: zodResolver(formSchema), defaultValues: { "switch-gaming": false, "switch-streaming": false, "switch-prior-experience": false, "switch-audio-tech-familiarity": false } });
    const { setFormData } = useStoreComponentPretestForm();

    const handleValidSubmit = async (data) => {
        setFormData(data);
        await onSubmit(data);
    };

    useImperativeHandle(ref, () => ({
        submit: async () => {
            let isSuccess = false;
            await form.handleSubmit(
                async () => {
                    await handleValidSubmit(form.getValues());
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
        <form onSubmit={(e) => e.preventDefault()} className="w-full rounded-md border p-8">
            <FieldGroup className="grid grid-cols-6 gap-x-4 gap-y-6">
                <Controller
                    name="input-age"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid} className="col-span-3 gap-1">
                            <FieldLabel htmlFor="input-age">Alter</FieldLabel>
                            <Input
                                {...field}
                                id="input-age"
                                type="number"
                                onChange={(e) => {
                                    field.onChange(e.target.value);
                                }}
                                aria-invalid={fieldState.invalid}
                                placeholder="Bitte angeben"
                            />
                            <FieldDescription>Wie alt sind Sie?</FieldDescription>
                            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                        </Field>
                    )}
                />

                <Controller
                    name="select-gender"
                    control={form.control}
                    render={({ field, fieldState }) => {
                        const options = [
                            { value: "female", label: "Weiblich" },
                            { value: "male", label: "Männlich" },
                            { value: "non-binary", label: "Non-Binär" },
                            { value: "other", label: "Andere" },
                            { value: "no-choice", label: "Keine Angabe" }
                        ];
                        return (
                            <Field data-invalid={fieldState.invalid} className="col-span-3 gap-1">
                                <FieldLabel htmlFor="select-gender">Gender</FieldLabel>
                                <Select value={field.value} onValueChange={field.onChange}>
                                    <SelectTrigger className="w-full" aria-invalid={fieldState.invalid}>
                                        <SelectValue placeholder="Bitte angeben" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {options.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FieldDescription>Wie identifizieren Sie sich?</FieldDescription>
                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                            </Field>
                        );
                    }}
                />

                <Controller
                    name="select-german-proficiency"
                    control={form.control}
                    render={({ field, fieldState }) => {
                        const options = [
                            { value: "native", label: "Muttersprache" },
                            { value: "level-c", label: "C1/2 (Verhandlungssicher)" },
                            { value: "level-b", label: "B1/2 (Gesprächssicher)" },
                            { value: "level-a", label: "A1/2 (Anfänger)" },
                            { value: "other", label: "Keine der genannten" }
                        ];
                        return (
                            <Field data-invalid={fieldState.invalid} className="col-span-full gap-1">
                                <FieldLabel htmlFor="select-german-proficiency">Deutschkenntnisse</FieldLabel>
                                <Select value={field.value} onValueChange={field.onChange}>
                                    <SelectTrigger className="w-full" aria-invalid={fieldState.invalid}>
                                        <SelectValue placeholder="Bitte angeben" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {options.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FieldDescription>Wie würden Sie Ihre Deutschkenntnisse einschätzen?</FieldDescription>
                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                            </Field>
                        );
                    }}
                />

                <Controller
                    name="select-hours-internet"
                    control={form.control}
                    render={({ field, fieldState }) => {
                        const options = [
                            { value: "less-than-3h", label: "< 3 h/Woche (~ 25 min/Tag)" },
                            { value: "between-3h-6h", label: "3–6 h/Woche (~ 25–50 min/Tag)" },
                            { value: "between-6h-9h", label: "6–9 h/Woche (~ 1 h/Tag)" },
                            { value: "between-9h-15h", label: "9–15 h/Woche (~ 1–2 h/Tag)" },
                            { value: "between-15h-21h", label: "15–21 h/Woche (~ 2–3 h/Tag)" },
                            { value: "between-21h-30h", label: "21–30 h/Woche (~ 3–4 h/Tag)" },
                            { value: "between-30h-40h", label: "30–40 h/Woche (~ 4–6 h/Tag)" },
                            { value: "between-40h-60h", label: "40–60 h/Woche (~ 6–8 h/Tag)" },
                            { value: "more-than-60h", label: "> 60 h/Woche (~ 8 h/Tag)" }
                        ];
                        return (
                            <Field data-invalid={fieldState.invalid} className="col-span-3 gap-1">
                                <FieldLabel htmlFor="select-hours-internet">Stunden im Internet / Woche</FieldLabel>
                                <Select value={field.value} onValueChange={field.onChange}>
                                    <SelectTrigger className="w-full" aria-invalid={fieldState.invalid}>
                                        <SelectValue placeholder="Bitte angeben" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {options.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FieldDescription>Wie viele Stunden pro Woche verbringen Sie im Durchschnitt im Internet?</FieldDescription>
                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                            </Field>
                        );
                    }}
                />

                <Controller
                    name="select-hours-calls"
                    control={form.control}
                    render={({ field, fieldState }) => {
                        const options = [
                            { value: "less-than-3h", label: "< 3 h/Woche (~ 25 min/Tag)" },
                            { value: "between-3h-6h", label: "3–6 h/Woche (~ 25–50 min/Tag)" },
                            { value: "between-6h-9h", label: "6–9 h/Woche (~ 1 h/Tag)" },
                            { value: "between-9h-15h", label: "9–15 h/Woche (~ 1–2 h/Tag)" },
                            { value: "between-15h-21h", label: "15–21 h/Woche (~ 2–3 h/Tag)" },
                            { value: "between-21h-30h", label: "21–30 h/Woche (~ 3–4 h/Tag)" },
                            { value: "between-30h-40h", label: "30–40 h/Woche (~ 4–6 h/Tag)" },
                            { value: "between-40h-60h", label: "40–60 h/Woche (~ 6–8 h/Tag)" },
                            { value: "more-than-60h", label: "> 60 h/Woche (~ 8 h/Tag)" }
                        ];
                        return (
                            <Field data-invalid={fieldState.invalid} className="col-span-3 gap-1">
                                <FieldLabel htmlFor="select-hours-calls">Stunden in (Video)Calls / Woche</FieldLabel>
                                <Select value={field.value} onValueChange={field.onChange}>
                                    <SelectTrigger className="w-full" aria-invalid={fieldState.invalid}>
                                        <SelectValue placeholder="Bitte angeben" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {options.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FieldDescription>Wie viele Stunden pro Woche telefonieren Sie im Durchschnitt über das Internet (z.B. Discord, Zoom, WhatsApp, etc.)?</FieldDescription>
                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                            </Field>
                        );
                    }}
                />

                <Controller
                    name="slider-experience"
                    control={form.control}
                    defaultValue={50}
                    render={({ field, fieldState }) => {
                        const { max = 100 } = field;
                        const value = Array.isArray(field.value) ? field.value : [field.value ?? max / 2];
                        return (
                            <Field data-invalid={fieldState.invalid} className="col-span-full">
                                <FieldLabel htmlFor={field.name}>Bisherige Erfahrung mit Sprach/Videotelefonie</FieldLabel>
                                <Slider {...field} value={value} onValueChange={(newValue) => field.onChange(newValue[0])} aria-invalid={fieldState.invalid} min={0} max={100} step={1} />
                                <div className="flex justify-between">
                                    <span className="text-sm whitespace-nowrap text-muted-foreground">Nicht erfahren</span>
                                    <span className="text-sm whitespace-nowrap text-muted-foreground">Sehr erfahren</span>
                                </div>
                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                            </Field>
                        );
                    }}
                />

                <Controller
                    name="switch-gaming"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field orientation="horizontal" data-invalid={fieldState.invalid} className="col-span-3">
                            <FieldContent>
                                <FieldLabel htmlFor="switch-gaming">Spielen Sie Videospiele mit Voicechat?</FieldLabel>
                                <FieldDescription>z.B. über Discord, TeamSpeak, etc.</FieldDescription>
                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                            </FieldContent>
                            <Switch {...field} aria-invalid={fieldState.invalid} id="switch-gaming" checked={field.value} onCheckedChange={field.onChange} />
                        </Field>
                    )}
                />

                <Controller
                    name="switch-streaming"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field orientation="horizontal" data-invalid={fieldState.invalid} className="col-span-3">
                            <FieldContent>
                                <FieldLabel htmlFor="switch-streaming">Streamen Sie Ihr Gameplay live?</FieldLabel>
                                <FieldDescription>z.B. über Twitch, YouTube, etc.</FieldDescription>
                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                            </FieldContent>
                            <Switch {...field} aria-invalid={fieldState.invalid} id="switch-streaming" checked={field.value} onCheckedChange={field.onChange} />
                        </Field>
                    )}
                />

                <Controller
                    name="switch-prior-experience"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field orientation="horizontal" data-invalid={fieldState.invalid} className="col-span-3">
                            <FieldContent>
                                <FieldLabel htmlFor="switch-prior-experience">Schon Erfahrung gesammelt?</FieldLabel>
                                <FieldDescription>Haben Sie schon einmal an einem Hörtest/-experiment teilgenommen?</FieldDescription>
                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                            </FieldContent>
                            <Switch {...field} aria-invalid={fieldState.invalid} id="switch-prior-experience" checked={field.value} onCheckedChange={field.onChange} />
                        </Field>
                    )}
                />

                <Controller
                    name="switch-audio-tech-familiarity"
                    control={form.control}
                    render={({ field, fieldState }) => (
                        <Field orientation="horizontal" data-invalid={fieldState.invalid} className="col-span-3">
                            <FieldContent>
                                <FieldLabel htmlFor="switch-audio-tech-familiarity">Kontakt mit Audiotechnik?</FieldLabel>
                                <FieldDescription>Haben Sie regelmäßig (z.B. über Ihre Arbeit) mit Audiotechnikverfahren/-forschung zu tun?</FieldDescription>
                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                            </FieldContent>
                            <Switch {...field} aria-invalid={fieldState.invalid} id="switch-audio-tech-familiarity" checked={field.value} onCheckedChange={field.onChange} />
                        </Field>
                    )}
                />
            </FieldGroup>
        </form>
    );
});

PretestForm.displayName = "PretestForm";

export default PretestForm;
