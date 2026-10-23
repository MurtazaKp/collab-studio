import { MODULES, MODULE_TYPES, type ModuleType } from "@collabverse/shared";
import { ModuleIcon } from "@/components/ui/module-icon";

type Card = { title: string; tag: ModuleType; who: string; color: string };

const COLUMNS: { name: string; cards: Card[] }[] = [
  {
    name: "To do",
    cards: [
      { title: "Draft Q3 client newsletter", tag: "docs", who: "AR", color: "var(--c-sky)" },
      { title: "Office move: to-do list", tag: "shopping", who: "JM", color: "var(--c-amber)" },
    ],
  },
  {
    name: "In progress",
    cards: [
      { title: "Onboarding flow sketch", tag: "whiteboard", who: "SK", color: "var(--c-rose)" },
      { title: "Fix invoice export script", tag: "code", who: "DL", color: "var(--c-teal)" },
    ],
  },
  {
    name: "Done",
    cards: [{ title: "Brainstorm: spring campaign", tag: "mindmap", who: "AR", color: "var(--c-sky)" }],
  },
];

function Cursor({ name, color, className }: { name: string; color: string; className: string }) {
  return (
    <div className={`pointer-events-none absolute flex items-start ${className}`}>
      <svg viewBox="0 0 16 20" className="size-4 drop-shadow-sm" aria-hidden>
        <path d="M1 1 L1 16 L5 12 L8 19 L11 17.5 L8 11 L14 11 Z" fill={color} stroke="var(--surface)" strokeWidth="1.2" />
      </svg>
      <span
        className="mt-3 -ml-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
        style={{ background: color, color: "var(--surface)" }}
      >
        {name}
      </span>
    </div>
  );
}

/** Static, decorative mock of a CollabVerse workspace: sidebar, kanban board and two live cursors. */
export function ProductPreview() {
  return (
    <figure className="relative">
      <figcaption className="sr-only">
        Illustration of a CollabVerse workspace: a sidebar listing the eight tools, a Kanban board with three
        columns, and two teammates&apos; cursors moving on the board at the same time.
      </figcaption>
      <div aria-hidden className="overflow-hidden rounded-xl border border-border bg-surface shadow-lg select-none">
        {/* Title bar */}
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
            <span className="truncate font-medium text-text">Harbour Studio</span>
            <span className="text-muted">/</span>
            <span className="truncate text-text-2">Office projects</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[11.5px] text-text-2 sm:flex">
              <span className="size-1.5 animate-shimmer rounded-full bg-success" />3 here now
            </span>
            <div className="flex -space-x-1.5">
              {[
                ["AR", "var(--c-sky)"],
                ["SK", "var(--c-rose)"],
                ["DL", "var(--c-teal)"],
              ].map(([i, c]) => (
                <span
                  key={i}
                  className="inline-flex size-5.5 items-center justify-center rounded-full text-[9px] font-semibold ring-2 ring-surface-2"
                  style={{ background: c, color: "var(--surface)" }}
                >
                  {i}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="flex">
          {/* Sidebar */}
          <div className="hidden w-44 shrink-0 border-r border-border bg-surface-2/60 p-3 md:block">
            <p className="px-2 pb-2 font-mono text-[10px] tracking-wider text-muted uppercase">Tools</p>
            <ul className="space-y-0.5">
              {MODULE_TYPES.map((t) => (
                <li
                  key={t}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] ${
                    t === "kanban" ? "bg-surface font-medium text-text shadow-sm" : "text-text-2"
                  }`}
                >
                  <ModuleIcon type={t} className="size-3.5" />
                  {MODULES[t].label}
                </li>
              ))}
            </ul>
          </div>

          {/* Board */}
          <div className="relative min-w-0 flex-1 p-4">
            <div className="mb-3 flex items-center gap-2">
              <ModuleIcon type="kanban" tile />
              <span className="text-[14px] font-semibold text-text">Office projects</span>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {COLUMNS.map((col, ci) => (
                <div key={col.name} className={`rounded-lg bg-surface-2 p-2 ${ci === 2 ? "hidden lg:block" : ""}`}>
                  <div className="flex items-center justify-between px-1 pb-2">
                    <span className="text-[11.5px] font-medium text-text-2">{col.name}</span>
                    <span className="font-mono text-[10.5px] text-muted">{col.cards.length}</span>
                  </div>
                  <div className="space-y-2">
                    {col.cards.map((card) => (
                      <div key={card.title} className="rounded-md border border-border bg-surface p-2.5 shadow-sm">
                        <p className="text-[12px] leading-snug text-text">{card.title}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="inline-flex items-center gap-1 text-[10.5px] text-muted">
                            <ModuleIcon type={card.tag} className="size-3" />
                            {MODULES[card.tag].label}
                          </span>
                          <span
                            className="inline-flex size-4.5 items-center justify-center rounded-full text-[8px] font-semibold"
                            style={{ background: card.color, color: "var(--surface)" }}
                          >
                            {card.who}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Cursor name="Sana" color="var(--c-rose)" className="top-[46%] left-[30%]" />
            <Cursor name="Dev" color="var(--c-teal)" className="top-[70%] left-[62%]" />
          </div>
        </div>
      </div>
    </figure>
  );
}
