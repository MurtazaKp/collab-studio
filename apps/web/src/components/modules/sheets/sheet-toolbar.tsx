"use client";

import { useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownAZ,
  ArrowDownZA,
  ArrowDownToLine,
  ArrowRightToLine,
  Baseline,
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Bold,
  Columns3,
  Download,
  Filter,
  Italic,
  PaintBucket,
  Pin,
  RemoveFormatting,
  Rows3,
  Trash2,
  Upload,
} from "lucide-react";
import type { NumberFormat } from "@collabverse/shared/sheet";
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { FILL_COLORS, TEXT_COLORS } from "./sheet-utils";

export interface ToolbarState {
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right" | null;
  num: NumberFormat;
  color: string | null;
  fill: string | null;
  frozen: boolean;
  filtering: boolean;
}

export interface ToolbarActions {
  toggleBold: () => void;
  toggleItalic: () => void;
  setAlign: (a: "left" | "center" | "right") => void;
  setNum: (n: NumberFormat) => void;
  setColor: (c: string | null) => void;
  setFill: (c: string | null) => void;
  clearFormat: () => void;
  insertRow: (where: "above" | "below") => void;
  deleteRows: () => void;
  insertCol: (where: "left" | "right") => void;
  deleteCols: () => void;
  toggleFreeze: () => void;
  sort: (dir: "asc" | "desc") => void;
  toggleFilter: () => void;
  importCsv: (file: File) => void;
  exportCsv: () => void;
}

function Tool({ label, onClick, active, children, kbd, danger }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode; kbd?: string; danger?: boolean }) {
  return (
    <Tooltip label={kbd ? `${label} · ${kbd}` : label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active ?? undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn(
          "flex size-7 items-center justify-center rounded-md transition-colors [&>svg]:size-4",
          active ? "bg-accent-soft text-accent" : danger ? "text-text-2 hover:bg-danger-soft hover:text-danger" : "text-text-2 hover:bg-surface-2 hover:text-text",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function Swatches({ label, icon, current, colors, onPick }: { label: string; icon: React.ReactNode; current: string | null; colors: string[]; onPick: (c: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip label={label}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onMouseDown={(e) => e.preventDefault()}
            className="relative flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text [&>svg]:size-4"
          >
            {icon}
            <span aria-hidden className="absolute bottom-1 h-[3px] w-4 rounded-full border border-border" style={{ background: current ?? "transparent" }} />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent className="w-auto p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div role="group" aria-label={label} className="grid grid-cols-5 gap-1.5">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
              className={cn("size-6 rounded-md border border-black/10 hover:scale-110", current === c && "ring-2 ring-accent ring-offset-1 ring-offset-surface")}
              style={{ background: c }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            onPick(null);
            setOpen(false);
          }}
          className="mt-2 w-full rounded-md px-2 py-1 text-[12px] text-text-2 hover:bg-surface-2"
        >
          No colour
        </button>
      </PopoverContent>
    </Popover>
  );
}

const SEP = "ml-1 border-l border-border pl-1.5";

export interface ToolbarExtras {
  fill: (direction: "down" | "right") => void;
  insertRowBelow: () => void;
  insertColRight: () => void;
}

export function SheetToolbar({ state, actions, extra, canEdit }: { state: ToolbarState; actions: ToolbarActions; extra: ToolbarExtras; canEdit: boolean }) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <div role="toolbar" aria-label="Sheet tools" className="flex shrink-0 flex-wrap items-center gap-y-1 border-b border-border bg-surface px-3 py-1">
      {canEdit ? (
        <>
          <div className="flex items-center gap-0.5">
            <Tool label="Bold" kbd="Ctrl+B" active={state.bold} onClick={actions.toggleBold}>
              <Bold />
            </Tool>
            <Tool label="Italic" kbd="Ctrl+I" active={state.italic} onClick={actions.toggleItalic}>
              <Italic />
            </Tool>
            <Swatches label="Text colour" icon={<Baseline />} current={state.color} colors={TEXT_COLORS} onPick={actions.setColor} />
            <Swatches label="Fill colour" icon={<PaintBucket />} current={state.fill} colors={FILL_COLORS} onPick={actions.setFill} />
          </div>
          <div className={cn("flex items-center gap-0.5", SEP)}>
            <Tool label="Align left" active={state.align === "left"} onClick={() => actions.setAlign("left")}>
              <AlignLeft />
            </Tool>
            <Tool label="Align centre" active={state.align === "center"} onClick={() => actions.setAlign("center")}>
              <AlignCenter />
            </Tool>
            <Tool label="Align right" active={state.align === "right"} onClick={() => actions.setAlign("right")}>
              <AlignRight />
            </Tool>
            <select
              aria-label="Number format"
              value={state.num}
              onChange={(e) => actions.setNum(e.target.value as NumberFormat)}
              className="ml-1 h-7 rounded-md border border-transparent bg-transparent px-1.5 text-[12.5px] text-text-2 hover:border-border hover:bg-surface-2 focus-visible:border-accent focus-visible:outline-none"
            >
              <option value="auto">Automatic</option>
              <option value="number">Number 1,234.50</option>
              <option value="currency">Currency $1,234.50</option>
              <option value="percent">Percent 12.5%</option>
              <option value="date">Date</option>
            </select>
            <Tool label="Clear formatting" onClick={actions.clearFormat}>
              <RemoveFormatting />
            </Tool>
          </div>
          <div className={cn("flex items-center gap-0.5", SEP)}>
            <Tool label="Insert row above" onClick={() => actions.insertRow("above")}>
              <Rows3 />
            </Tool>
            <Tool label="Insert row below" onClick={extra.insertRowBelow}>
              <BetweenHorizontalEnd />
            </Tool>
            <Tool label="Insert column left" onClick={() => actions.insertCol("left")}>
              <Columns3 />
            </Tool>
            <Tool label="Insert column right" onClick={extra.insertColRight}>
              <BetweenVerticalEnd />
            </Tool>
            <Tool label="Delete selected rows" danger onClick={actions.deleteRows}>
              <span className="relative">
                <Rows3 />
                <Trash2 className="absolute -right-1.5 -bottom-1.5 size-2.5" />
              </span>
            </Tool>
            <Tool label="Delete selected columns" danger onClick={actions.deleteCols}>
              <span className="relative">
                <Columns3 />
                <Trash2 className="absolute -right-1.5 -bottom-1.5 size-2.5" />
              </span>
            </Tool>
            <Tool label={state.frozen ? "Unfreeze header row" : "Freeze header row"} active={state.frozen} onClick={actions.toggleFreeze}>
              <Pin />
            </Tool>
          </div>
          <div className={cn("flex items-center gap-0.5", SEP)}>
            <Tool label="Fill down from the top of the selection" kbd="Ctrl+D" onClick={() => extra.fill("down")}>
              <ArrowDownToLine />
            </Tool>
            <Tool label="Fill right from the left of the selection" kbd="Ctrl+R" onClick={() => extra.fill("right")}>
              <ArrowRightToLine />
            </Tool>
          </div>
          <div className={cn("flex items-center gap-0.5", SEP)}>
            <Tool label="Sort A to Z by this column" onClick={() => actions.sort("asc")}>
              <ArrowDownAZ />
            </Tool>
            <Tool label="Sort Z to A by this column" onClick={() => actions.sort("desc")}>
              <ArrowDownZA />
            </Tool>
          </div>
        </>
      ) : null}
      <div className={cn("flex items-center gap-0.5", canEdit && SEP)}>
        <Tool label="Filter rows" active={state.filtering} onClick={actions.toggleFilter}>
          <Filter />
        </Tool>
        {canEdit ? (
          <>
            <Tool label="Import CSV at the selected cell" onClick={() => file.current?.click()}>
              <Upload />
            </Tool>
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) actions.importCsv(f);
                e.target.value = "";
              }}
            />
          </>
        ) : null}
        <Tool label="Export as CSV" onClick={actions.exportCsv}>
          <Download />
        </Tool>
      </div>
    </div>
  );
}
