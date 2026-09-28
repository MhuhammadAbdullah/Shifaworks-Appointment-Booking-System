import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** A small (ⓘ) icon with a hint. Hover shows it on desktop; tapping the button focuses it, which shows it on touch too. */
export function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground" aria-label={text}>
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
