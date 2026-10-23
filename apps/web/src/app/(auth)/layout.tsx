import { Check } from "lucide-react";
import { MODULE_TYPES } from "@collabverse/shared";
import { Wordmark } from "@/components/shell/wordmark";
import { ModuleIcon } from "@/components/ui/module-icon";

const POINTS = [
  "Docs, whiteboards, boards, chat and more in one workspace",
  "Live cursors and presence; edits sync instantly",
  "One flat price per workspace, not per seat",
  "Private by default, with Owner, Admin, Member and Viewer roles",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-surface-2 p-10 lg:flex">
        <Wordmark />
        <div className="max-w-md">
          <div aria-hidden className="flex items-center gap-1.5">
            {MODULE_TYPES.map((t) => (
              <ModuleIcon key={t} type={t} tile />
            ))}
          </div>
          <p className="mt-8 font-display text-[42px] leading-[1.06] tracking-tight text-text">
            The whole office,
            <br />
            on the same page.
          </p>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[14.5px] leading-snug text-text-2">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[13px] text-text-2">14-day Team trial. No card required.</p>
      </aside>
      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 lg:hidden">
            <Wordmark />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
