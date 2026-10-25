import { Check } from "lucide-react";
import { MODULES, type ModuleType } from "@collabverse/shared";
import { ModuleIcon } from "@/components/ui/module-icon";

/** The three most recent tools, with the details a buyer would ask about. */
export const NEW_TOOLS: { type: ModuleType; pitch: string; points: string[] }[] = [
  {
    type: "calendar",
    pitch: "One place for meetings, deadlines and the office diary.",
    points: ["Shared calendars per team or project", "Events with attendees", "Attendees get notified"],
  },
  {
    type: "polls",
    pitch: "Settle the lunch venue or the launch date without a 40-message thread.",
    points: ["Create a poll in seconds", "Results update live", "Optional anonymous voting"],
  },
  {
    type: "sheets",
    pitch: "A spreadsheet the whole team edits at once, cell by cell.",
    points: ["Formulas and formatting", "Copy, paste, sort and filter", "CSV import and export"],
  },
];

export function NewTools() {
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {NEW_TOOLS.map(({ type, pitch, points }) => (
        <li key={type} className="flex flex-col rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <ModuleIcon type={type} tile />
            <h3 className="text-[16px] font-semibold text-text">{MODULES[type].label}</h3>
            <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">New</span>
          </div>
          <p className="mt-4 text-[14.5px] leading-relaxed text-text">{pitch}</p>
          <ul className="mt-4 space-y-2 border-t border-border pt-4">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-[13.5px] text-text-2">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
                {p}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
