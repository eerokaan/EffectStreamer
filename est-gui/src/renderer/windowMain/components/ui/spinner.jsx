import { cn } from "@/lib/utils";
import { Loader2Icon } from "lucide-react";
import { useTranslate } from "@/lib/helper-languages";

function Spinner({ className, ...props }) {
    const __ = useTranslate();
    return <Loader2Icon role="status" aria-label={__("Loading")} className={cn("size-4 animate-spin", className)} {...props} />;
}

export { Spinner };
