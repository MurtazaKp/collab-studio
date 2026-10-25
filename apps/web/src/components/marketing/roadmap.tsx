import { ClipboardList, FolderOpen, LayoutTemplate, Plane, Target, type LucideIcon } from "lucide-react";

/**
 * Tools we plan to build. None of these exist yet, so the copy says so and
 * nothing here links anywhere. No dates on purpose.
 */
export const ROADMAP: { name: string; body: string; icon: LucideIcon }[] = [
  { name: "Forms", body: "Collect sign-ups, requests and feedback, with answers landing in the workspace.", icon: ClipboardList },
  { name: "File library", body: "One shared home for the files your team keeps hunting for.", icon: FolderOpen },
  { name: "Time off", body: "Request leave and see who is out, without a spreadsheet on the side.", icon: Plane },
  { name: "Goals and OKRs", body: "Set goals for the quarter and track progress together.", icon: Target },
  { name: "Whiteboard templates", body: "Ready-made retros, planning grids and journey maps to start from.", icon: LayoutTemplate },
];

export function Roadmap() {
  return (
    <ul className="grid gap-px overflow-hidden rounded-xl border border-dashed border-border-strong bg-border sm:grid-cols-2 lg:grid-cols-3">
      {ROADMAP.map(({ name, body, icon: Icon }) => (
        <li key={name} className="flex gap-4 bg-bg p-5 sm:p-6">
          <span
            aria-hidden
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong text-muted"
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h3 className="text-[15.5px] font-semibold text-text">{name}</h3>
              <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10.5px] tracking-wide text-text-2 uppercase">
                Planned
              </span>
            </div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-text-2">{body}</p>
          </div>
        </li>
      ))}
      <li className="flex items-center bg-bg p-5 sm:p-6">
        <p className="text-[14px] leading-relaxed text-text-2">
          The list keeps growing, and what customers ask for shapes what we build next.
        </p>
      </li>
    </ul>
  );
}
