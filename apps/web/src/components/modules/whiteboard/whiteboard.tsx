"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import {
  ArrowUpRight,
  Circle,
  Hand,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Square,
  StickyNote,
  Trash2,
  Type,
  Copy,
  BringToFront,
} from "lucide-react";
import {
  WB_COLORS,
  addObject,
  bringToFront,
  deleteObjects,
  objectsMap,
  readWhiteboard,
  updateObjects,
  defaultFontSize,
  type WbColor,
  type WbObject,
  type WbObjectType,
  type WbPatch,
} from "@collabverse/shared/whiteboard";
import { roomName } from "@collabverse/shared";
import { useCollabRoom, useCollaborators } from "@/lib/collab/react";
import type { CollabSession } from "@/lib/collab/types";
import { useWorkspace } from "@/lib/workspace-context";
import type { ItemRow } from "@/lib/data/items";
import { CollabGate, CollabHeader, useLiveItem } from "@/components/modules/collab-chrome";
import { Tooltip } from "@/components/ui/menu";
import { Kbd } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { edgePoint, fitViewport, normRect, rectsIntersect, strokePath, toCanvas, zoomAt, type Point, type Viewport } from "./geometry";

type Tool = "select" | "hand" | "sticky" | "text" | "rect" | "ellipse" | "connector" | "pen";

const FILL: Record<WbColor, string> = {
  yellow: "#fde68a",
  pink: "#fbcfe8",
  blue: "#bfdbfe",
  green: "#bbf7d0",
  purple: "#ddd6fe",
  ink: "#27272a",
  white: "#ffffff",
};
const STROKE: Record<WbColor, string> = {
  yellow: "#b45309",
  pink: "#be185d",
  blue: "#1d4ed8",
  green: "#15803d",
  purple: "#6d28d9",
  ink: "#18181b",
  white: "#71717a",
};

// Text size steps offered by the A−/A+ controls (px).
const FONT_STEPS = [12, 14, 15, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96] as const;

/** Pen strokes: the swatch colour itself (borders use the darker STROKE set). */
const PEN: Record<WbColor, string> = {
  yellow: "#eab308",
  pink: "#ec4899",
  blue: "#2563eb",
  green: "#16a34a",
  purple: "#7c3aed",
  ink: "#18181b",
  white: "#ffffff",
};

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode; edit: boolean }[] = [
  { tool: "select", label: "Select", key: "V", icon: <MousePointer2 />, edit: false },
  { tool: "hand", label: "Pan", key: "H", icon: <Hand />, edit: false },
  { tool: "sticky", label: "Sticky note", key: "N", icon: <StickyNote />, edit: true },
  { tool: "text", label: "Text", key: "T", icon: <Type />, edit: true },
  { tool: "rect", label: "Rectangle", key: "R", icon: <Square />, edit: true },
  { tool: "ellipse", label: "Ellipse", key: "O", icon: <Circle />, edit: true },
  { tool: "connector", label: "Connector", key: "C", icon: <ArrowUpRight />, edit: true },
  { tool: "pen", label: "Draw", key: "P", icon: <Pencil />, edit: true },
];

type Drag =
  | { kind: "pan"; start: Point; vp: Viewport }
  | { kind: "move"; start: Point; origins: Map<string, Point>; moved: boolean }
  | { kind: "resize"; id: string; start: Point; origin: { w: number; h: number } }
  | { kind: "marquee"; start: Point; current: Point; additive: boolean }
  | { kind: "create"; type: "rect" | "ellipse"; start: Point; current: Point }
  | { kind: "connect"; from: string; current: Point }
  | { kind: "draw"; points: number[] };

export function Whiteboard({ board }: { board: ItemRow }) {
  const { session, state } = useCollabRoom(roomName("whiteboard", board.id));
  const { item, deleted } = useLiveItem("whiteboard", board);
  return (
    <div className="flex h-full flex-col">
      <CollabHeader module="whiteboard" item={item} session={session} state={state} />
      <CollabGate state={state} deleted={deleted} module="whiteboard">
        {session ? <Canvas key={session.room} session={session} readOnly={state.access !== "read-write"} /> : null}
      </CollabGate>
    </div>
  );
}

function useBoardObjects(doc: Y.Doc): WbObject[] {
  const [objects, setObjects] = useState<WbObject[]>(() => readWhiteboard(doc));
  useEffect(() => {
    const map = objectsMap(doc);
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setObjects(readWhiteboard(doc)));
    };
    map.observeDeep(update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      map.unobserveDeep(update);
    };
  }, [doc]);
  return objects;
}

function Canvas({ session, readOnly }: { session: CollabSession; readOnly: boolean }) {
  const { canEdit } = useWorkspace();
  const editable = canEdit && !readOnly;
  const doc = session.doc;
  const objects = useBoardObjects(doc);
  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const collaborators = useCollaborators(session.awareness);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<WbColor>("yellow");
  // Until a colour is picked, each tool uses its own sensible default
  // (yellow stickies, blue shapes, ink pen/text); after that, the pick wins.
  const [colorChosen, setColorChosen] = useState(false);
  const colorFor = (fallback: WbColor): WbColor => (colorChosen ? color : fallback);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const fitted = useRef(false);

  const undo = useMemo(() => new Y.UndoManager(objectsMap(doc), { captureTimeout: 400 }), [doc]);
  useEffect(() => () => undo.destroy(), [undo]);

  // Fit content once on open.
  useEffect(() => {
    if (fitted.current || !containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    setVp(fitViewport(objects, r.width, r.height));
    fitted.current = true;
  }, [objects]);

  // Drop selections of objects that disappeared remotely. Only ids that were
  // rendered before and are now gone count: a just-created object is not in
  // `objects` until the next frame, and must not be treated as deleted.
  const prevIds = useRef<Map<string, WbObject>>(new Map());
  useEffect(() => {
    const prev = prevIds.current;
    prevIds.current = byId;
    const removed = (id: string) => prev.has(id) && !byId.has(id);
    setSelected((s) => {
      const next = new Set([...s].filter((id) => !removed(id)));
      return next.size === s.size ? s : next;
    });
    if (editingId && removed(editingId)) setEditingId(null);
  }, [byId, editingId]);

  // Broadcast selection for remote highlight.
  useEffect(() => {
    session.awareness.setLocalStateField("selection", [...selected]);
  }, [selected, session.awareness]);

  const screenPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const lastCursor = useRef(0);
  const broadcastCursor = (p: Point | null) => {
    const now = performance.now();
    if (p && now - lastCursor.current < 40) return;
    lastCursor.current = now;
    session.awareness.setLocalStateField("cursor", p ? { x: Math.round(p.x), y: Math.round(p.y) } : null);
  };

  const moveFrame = useRef(0);
  const pendingPatch = useRef<Record<string, WbPatch>>({});
  const scheduleUpdate = (patches: Record<string, WbPatch>) => {
    Object.assign(pendingPatch.current, patches);
    if (moveFrame.current) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = 0;
      const p = pendingPatch.current;
      pendingPatch.current = {};
      updateObjects(doc, p);
    });
  };

  const hitId = (target: EventTarget | null): string | null => {
    const el = (target as Element | null)?.closest?.("[data-id]");
    return el ? el.getAttribute("data-id") : null;
  };

  const create = (type: WbObjectType, at: Point, size?: { w: number; h: number }) => {
    const defaults: Record<string, { w: number; h: number }> = {
      sticky: { w: 180, h: 140 },
      text: { w: 220, h: 48 },
      rect: { w: 180, h: 110 },
      ellipse: { w: 150, h: 150 },
    };
    const s = size ?? defaults[type]!;
    const id = addObject(doc, {
      type,
      x: size ? at.x : at.x - s.w / 2,
      y: size ? at.y : at.y - s.h / 2,
      w: s.w,
      h: s.h,
      text: "",
      color: type === "sticky" ? color : colorFor(type === "text" ? "ink" : "blue"),
    });
    setSelected(new Set([id]));
    setTool("select");
    if (type === "sticky" || type === "text") setEditingId(id);
    return id;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (editingId) setEditingId(null);
    containerRef.current?.focus();
    const sp = screenPoint(e);
    const p = toCanvas(sp, vp);
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (e.button === 1 || tool === "hand" || spaceDown) {
      setDrag({ kind: "pan", start: sp, vp });
      return;
    }
    const handle = (e.target as Element).closest?.("[data-handle]")?.getAttribute("data-handle");
    if (handle && editable) {
      const o = byId.get(handle);
      if (o) setDrag({ kind: "resize", id: o.id, start: p, origin: { w: o.w, h: o.h } });
      return;
    }
    const id = hitId(e.target);

    if (!editable || tool === "select") {
      if (id) {
        const next = new Set(e.shiftKey ? selected : selected.has(id) ? selected : []);
        if (e.shiftKey && selected.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
        if (editable) {
          const origins = new Map<string, Point>();
          for (const sid of next) {
            const o = byId.get(sid);
            if (o && o.type !== "connector") origins.set(sid, { x: o.x, y: o.y });
          }
          setDrag({ kind: "move", start: p, origins, moved: false });
        }
      } else {
        if (!e.shiftKey) setSelected(new Set());
        setDrag({ kind: "marquee", start: p, current: p, additive: e.shiftKey });
      }
      return;
    }
    if (tool === "sticky" || tool === "text") {
      // Stop the browser's mousedown focus change, which would otherwise blur
      // the new text editor the moment it mounts and end editing.
      e.preventDefault();
      create(tool, p);
      return;
    }
    if (tool === "rect" || tool === "ellipse") {
      setDrag({ kind: "create", type: tool, start: p, current: p });
      return;
    }
    if (tool === "connector") {
      if (id && byId.get(id)?.type !== "connector") setDrag({ kind: "connect", from: id, current: p });
      return;
    }
    if (tool === "pen") {
      setDrag({ kind: "draw", points: [p.x, p.y] });
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const sp = screenPoint(e);
    const p = toCanvas(sp, vp);
    broadcastCursor(p);
    if (!drag) return;
    switch (drag.kind) {
      case "pan":
        setVp({ ...drag.vp, x: drag.vp.x + sp.x - drag.start.x, y: drag.vp.y + sp.y - drag.start.y });
        break;
      case "move": {
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) * vp.zoom < 3) return;
        if (!drag.moved) setDrag({ ...drag, moved: true });
        const patches: Record<string, WbPatch> = {};
        for (const [id, o] of drag.origins) patches[id] = { x: Math.round(o.x + dx), y: Math.round(o.y + dy) };
        scheduleUpdate(patches);
        break;
      }
      case "resize":
        scheduleUpdate({
          [drag.id]: { w: Math.max(24, Math.round(drag.origin.w + p.x - drag.start.x)), h: Math.max(24, Math.round(drag.origin.h + p.y - drag.start.y)) },
        });
        break;
      case "marquee":
      case "create":
      case "connect":
        setDrag({ ...drag, current: p });
        break;
      case "draw": {
        const last = drag.points.slice(-2);
        if (Math.hypot(p.x - last[0]!, p.y - last[1]!) > 1.5 / vp.zoom) setDrag({ kind: "draw", points: [...drag.points, p.x, p.y] });
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = toCanvas(screenPoint(e), vp);
    switch (drag.kind) {
      case "marquee": {
        const box = normRect(drag.start, drag.current);
        if (box.w > 2 || box.h > 2) {
          const hits = objects.filter((o) => o.type !== "connector" && rectsIntersect(box, o)).map((o) => o.id);
          setSelected((s) => new Set([...(drag.additive ? s : []), ...hits]));
        }
        break;
      }
      case "create": {
        const box = normRect(drag.start, p);
        if (box.w > 8 && box.h > 8) create(drag.type, { x: box.x, y: box.y }, { w: Math.round(box.w), h: Math.round(box.h) });
        else create(drag.type, p);
        break;
      }
      case "connect": {
        const target = hitId(document.elementFromPoint(e.clientX, e.clientY));
        if (target && target !== drag.from && byId.get(target)?.type !== "connector") {
          addObject(doc, { type: "connector", x: 0, y: 0, w: 4, h: 4, text: "", color: "ink", from: drag.from, to: target });
        }
        break;
      }
      case "draw": {
        if (drag.points.length >= 4) {
          const xs = drag.points.filter((_, i) => i % 2 === 0);
          const ys = drag.points.filter((_, i) => i % 2 === 1);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          const rel = drag.points.map((v, i) => Math.round((v - (i % 2 === 0 ? minX : minY)) * 10) / 10);
          addObject(doc, {
            type: "path",
            x: minX,
            y: minY,
            w: Math.max(4, Math.max(...xs) - minX),
            h: Math.max(4, Math.max(...ys) - minY),
            text: "",
            color: colorFor("ink"),
            points: rel,
            strokeWidth: 4,
          });
        }
        break;
      }
    }
    setDrag(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const sp = screenPoint(e);
    if (e.ctrlKey || e.metaKey) setVp((v) => zoomAt(v, sp, Math.exp(-e.deltaY * 0.01)));
    else setVp((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };

  // Releasing Space outside the canvas (or switching windows) must not leave pan mode on.
  useEffect(() => {
    const reset = () => setSpaceDown(false);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") reset();
    };
    window.addEventListener("blur", reset);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("blur", reset);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Prevent the browser zooming the page on pinch/ctrl+wheel over the canvas.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const prevent = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", prevent, { passive: false });
    return () => el.removeEventListener("wheel", prevent);
  }, []);

  const selectedList = [...selected].map((id) => byId.get(id)).filter((o): o is WbObject => Boolean(o));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editingId) return;
    // Keys pressed on toolbar buttons and inputs belong to those controls.
    if ((e.target as HTMLElement).closest("button, input, textarea, select, [role=toolbar]")) return;

    const mod = e.metaKey || e.ctrlKey;
    if (e.key === " ") {
      setSpaceDown(true);
      e.preventDefault();
      return;
    }
    if (!editable) {
      if (e.key.toLowerCase() === "h") setTool("hand");
      if (e.key.toLowerCase() === "v") setTool("select");
      return;
    }
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) undo.redo();
      else undo.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      undo.redo();
      return;
    }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicate();
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(objects.map((o) => o.id)));
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selected.size) {
      e.preventDefault();
      deleteObjects(doc, [...selected]);
      setSelected(new Set());
      return;
    }
    if (e.key === "Escape") {
      setSelected(new Set());
      setTool("select");
      return;
    }
    if (e.key === "Enter" && selectedList.length === 1 && selectedList[0]!.type !== "connector" && selectedList[0]!.type !== "path") {
      e.preventDefault();
      setEditingId(selectedList[0]!.id);
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && selected.size) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key]!;
      const step = e.shiftKey ? 10 : 1;
      const patches: Record<string, WbPatch> = {};
      for (const o of selectedList) if (o.type !== "connector") patches[o.id] = { x: o.x + dx * step, y: o.y + dy * step };
      updateObjects(doc, patches);
      return;
    }
    if (!mod) {
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (t) setTool(t.tool);
    }
  };

  const duplicate = () => {
    const ids: string[] = [];
    doc.transact(() => {
      for (const o of selectedList) {
        if (o.type === "connector") continue;
        ids.push(
          addObject(doc, { type: o.type, x: o.x + 24, y: o.y + 24, w: o.w, h: o.h, text: o.text, color: o.color, points: o.points, strokeWidth: o.strokeWidth }),
        );
      }
    });
    setSelected(new Set(ids));
  };

  const setSelectionColor = (c: WbColor) => {
    setColor(c);
    setColorChosen(true);
    if (!selectedList.length) return;
    updateObjects(doc, Object.fromEntries(selectedList.map((o) => [o.id, { color: c }])));
  };

  // Objects in the selection that carry text, for the size controls.
  const textSelection = selectedList.filter((o) => o.type !== "connector" && o.type !== "path");
  const currentFontSize = textSelection.length ? textSelection[0]!.fontSize ?? defaultFontSize(textSelection[0]!.type) : null;
  const stepFontSize = (dir: 1 | -1) => {
    if (!textSelection.length) return;
    const patches: Record<string, WbPatch> = {};
    for (const o of textSelection) {
      const cur = o.fontSize ?? defaultFontSize(o.type);
      const next = dir > 0 ? FONT_STEPS.find((s) => s > cur) : [...FONT_STEPS].reverse().find((s) => s < cur);
      if (next === undefined) continue;
      // Free text grows its box so a larger size is not clipped.
      const minH = Math.ceil(next * 1.4 + 24);
      patches[o.id] = o.type === "text" && o.h < minH ? { fontSize: next, h: minH, w: Math.max(o.w, next * 8) } : { fontSize: next };
    }
    updateObjects(doc, patches);
  };

  const zoomBy = (f: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    setVp((v) => zoomAt(v, { x: r.width / 2, y: r.height / 2 }, f));
  };
  const fit = () => {
    const r = containerRef.current!.getBoundingClientRect();
    setVp(fitViewport(objects, r.width, r.height));
  };

  const remoteSelections = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of collaborators) {
      const sel = (session.awareness.getStates().get(c.clientId) as { selection?: unknown } | undefined)?.selection;
      if (Array.isArray(sel)) for (const id of sel) if (typeof id === "string") map.set(id, c.user.color);
    }
    return map;
  }, [collaborators, session.awareness]);

  const cursor =
    tool === "hand" || spaceDown || drag?.kind === "pan"
      ? drag?.kind === "pan"
        ? "grabbing"
        : "grab"
      : tool === "select" || !editable
        ? "default"
        : "crosshair";

  const single = selectedList.length === 1 ? selectedList[0]! : null;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.key === " " && setSpaceDown(false)}
      role="application"
      aria-label="Whiteboard canvas"
      aria-roledescription="whiteboard"
      className="relative min-h-0 flex-1 overflow-hidden bg-bg outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      <svg
        ref={svgRef}
        className="absolute inset-0 size-full touch-none select-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => broadcastCursor(null)}
        onWheel={onWheel}
        onDoubleClick={(e) => {
          if (!editable) return;
          const id = hitId(e.target);
          const o = id ? byId.get(id) : null;
          if (o && o.type !== "connector" && o.type !== "path") setEditingId(o.id);
          else if (!o) create("sticky", toCanvas(screenPoint(e), vp));
        }}
      >
        <defs>
          <pattern id="wb-dots" width={24 * vp.zoom} height={24 * vp.zoom} patternUnits="userSpaceOnUse" x={vp.x} y={vp.y}>
            <circle cx={1} cy={1} r={1} fill="var(--border-strong)" />
          </pattern>
          <marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#wb-dots)" />
        <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.zoom})`}>
          {objects.map((o) => (
            <ObjectShape
              key={o.id}
              o={o}
              byId={byId}
              selected={selected.has(o.id)}
              remoteColor={remoteSelections.get(o.id)}
              editing={editingId === o.id}
              onCommitText={(text) => updateObjects(doc, { [o.id]: { text } })}
              onDoneEditing={() => setEditingId(null)}
              zoom={vp.zoom}
            />
          ))}

          {single && editable && single.type !== "connector" && single.type !== "path" && !editingId ? (
            <rect
              data-handle={single.id}
              x={single.x + single.w - 5 / vp.zoom}
              y={single.y + single.h - 5 / vp.zoom}
              width={10 / vp.zoom}
              height={10 / vp.zoom}
              rx={2 / vp.zoom}
              fill="var(--surface)"
              stroke="var(--accent)"
              strokeWidth={1.5 / vp.zoom}
              style={{ cursor: "nwse-resize" }}
            />
          ) : null}

          {drag?.kind === "marquee" ? (() => {
            const b = normRect(drag.start, drag.current);
            return <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="rgb(75 79 216 / 0.08)" stroke="var(--accent)" strokeWidth={1 / vp.zoom} strokeDasharray={`${4 / vp.zoom}`} />;
          })() : null}
          {drag?.kind === "create" ? (() => {
            const b = normRect(drag.start, drag.current);
            return drag.type === "rect" ? (
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill="none" stroke="var(--accent)" strokeWidth={1.5 / vp.zoom} strokeDasharray={`${5 / vp.zoom}`} />
            ) : (
              <ellipse cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2} ry={b.h / 2} fill="none" stroke="var(--accent)" strokeWidth={1.5 / vp.zoom} strokeDasharray={`${5 / vp.zoom}`} />
            );
          })() : null}
          {drag?.kind === "connect" && byId.get(drag.from) ? (() => {
            const from = edgePoint(byId.get(drag.from)!, drag.current);
            return <line x1={from.x} y1={from.y} x2={drag.current.x} y2={drag.current.y} stroke="var(--accent)" strokeWidth={2 / vp.zoom} markerEnd="url(#wb-arrow)" strokeDasharray={`${5 / vp.zoom}`} />;
          })() : null}
          {drag?.kind === "draw" ? <path d={strokePath(drag.points, 4)} fill={PEN[colorFor("ink")]} /> : null}

          {collaborators.map((c) => {
            const cur = c.cursor as { x?: number; y?: number } | null | undefined;
            if (!cur || typeof cur.x !== "number" || typeof cur.y !== "number") return null;
            return (
              <g key={c.clientId} transform={`translate(${cur.x} ${cur.y}) scale(${1 / vp.zoom})`} style={{ pointerEvents: "none", transition: "transform 80ms linear" }}>
                <path d="M0 0 L0 16 L4.5 12 L7.5 19 L10 18 L7 11 L13 11 Z" fill={c.user.color} stroke="white" strokeWidth={1.2} />
                <g transform="translate(14 18)">
                  <rect x={0} y={0} rx={4} height={18} width={c.user.name.length * 6.6 + 12} fill={c.user.color} />
                  <text x={6} y={12.5} fill="white" fontSize={11} fontWeight={600} fontFamily="var(--font-sans)">
                    {c.user.name}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Tool palette */}
      <div role="toolbar" aria-label="Whiteboard tools" className="absolute top-1/2 left-3 flex -translate-y-1/2 flex-col gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-md">
        {TOOLS.filter((t) => editable || !t.edit).map((t) => (
          <Tooltip key={t.tool} side="right" label={<span className="flex items-center gap-2">{t.label} <Kbd>{t.key}</Kbd></span>}>
            <button
              aria-label={t.label}
              aria-pressed={tool === t.tool}
              onClick={() => setTool(t.tool)}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg transition-colors [&>svg]:size-4",
                tool === t.tool ? "bg-accent text-accent-text" : "text-text-2 hover:bg-surface-2 hover:text-text",
              )}
            >
              {t.icon}
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Context bar for colour / arrange */}
      {editable ? (
        <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-md">
          {WB_COLORS.map((c) => (
            <button
              key={c}
              aria-label={`Colour ${c}`}
              aria-pressed={(single?.color ?? color) === c}
              onClick={() => setSelectionColor(c)}
              className={cn("size-6 rounded-md border border-black/10 transition-transform hover:scale-110", (single?.color ?? color) === c && "ring-2 ring-accent ring-offset-1 ring-offset-surface")}
              style={{ background: FILL[c] }}
            />
          ))}
          {currentFontSize !== null ? (
            <>
              <span className="mx-1 h-5 w-px bg-border" />
              <Tooltip label="Smaller text">
                <button
                  aria-label="Decrease text size"
                  disabled={currentFontSize <= FONT_STEPS[0]!}
                  className="flex size-7 items-center justify-center rounded-md text-[12px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40"
                  onClick={() => stepFontSize(-1)}
                >
                  A−
                </button>
              </Tooltip>
              <span aria-label="Text size" className="w-7 text-center font-mono text-[12px] text-text-2 tabular-nums">
                {currentFontSize}
              </span>
              <Tooltip label="Larger text">
                <button
                  aria-label="Increase text size"
                  disabled={currentFontSize >= FONT_STEPS[FONT_STEPS.length - 1]!}
                  className="flex size-7 items-center justify-center rounded-md text-[15px] font-semibold text-text-2 hover:bg-surface-2 disabled:opacity-40"
                  onClick={() => stepFontSize(1)}
                >
                  A+
                </button>
              </Tooltip>
            </>
          ) : null}
          {selected.size ? (
            <>
              <span className="mx-1 h-5 w-px bg-border" />
              <Tooltip label="Bring to front">
                <button aria-label="Bring to front" className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2" onClick={() => bringToFront(doc, [...selected])}>
                  <BringToFront className="size-4" />
                </button>
              </Tooltip>
              <Tooltip label="Duplicate · Ctrl+D">
                <button aria-label="Duplicate" className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2" onClick={duplicate}>
                  <Copy className="size-4" />
                </button>
              </Tooltip>
              <Tooltip label="Delete · Del">
                <button
                  aria-label="Delete selection"
                  className="flex size-7 items-center justify-center rounded-md text-danger hover:bg-danger-soft"
                  onClick={() => {
                    deleteObjects(doc, [...selected]);
                    setSelected(new Set());
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </Tooltip>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Zoom controls */}
      <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-md">
        <button aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)} className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2">
          <Minus className="size-4" />
        </button>
        <span className="w-12 text-center font-mono text-[12px] text-text-2 tabular-nums">{Math.round(vp.zoom * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => zoomBy(1.2)} className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2">
          <Plus className="size-4" />
        </button>
        <Tooltip label="Fit to content">
          <button aria-label="Fit to content" onClick={fit} className="flex size-7 items-center justify-center rounded-md text-text-2 hover:bg-surface-2">
            <Maximize className="size-4" />
          </button>
        </Tooltip>
      </div>

      {objects.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="rounded-lg bg-surface/80 px-4 py-2 text-[13px] text-muted shadow-sm">
            {editable ? "Double-click anywhere to add a sticky note, or pick a tool on the left." : "This board is empty."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ObjectShape({
  o,
  byId,
  selected,
  remoteColor,
  editing,
  onCommitText,
  onDoneEditing,
  zoom,
}: {
  o: WbObject;
  byId: Map<string, WbObject>;
  selected: boolean;
  remoteColor?: string;
  editing: boolean;
  onCommitText: (text: string) => void;
  onDoneEditing: () => void;
  zoom: number;
}) {
  const outline = selected ? "var(--accent)" : remoteColor;
  const sw = 1.5 / zoom;

  if (o.type === "connector") {
    const a = byId.get(o.from!);
    const b = byId.get(o.to!);
    if (!a || !b) return null;
    const p1 = edgePoint(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const p2 = edgePoint(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 });
    return (
      <g data-id={o.id}>
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="transparent" strokeWidth={14 / zoom} />
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={outline ?? STROKE[o.color]} strokeWidth={selected ? 2.5 : 2} markerEnd="url(#wb-arrow)" />
      </g>
    );
  }

  if (o.type === "path") {
    return (
      <g data-id={o.id} transform={`translate(${o.x} ${o.y})`}>
        <rect x={-4} y={-4} width={o.w + 8} height={o.h + 8} fill="transparent" />
        <path d={strokePath(o.points ?? [], o.strokeWidth ?? 4)} fill={PEN[o.color]} />
        {outline ? <rect x={-6} y={-6} width={o.w + 12} height={o.h + 12} fill="none" stroke={outline} strokeWidth={sw} strokeDasharray={`${4 / zoom}`} rx={4} /> : null}
      </g>
    );
  }

  const fill = o.type === "text" ? "transparent" : FILL[o.color];
  const stroke = o.type === "sticky" || o.type === "text" ? "none" : STROKE[o.color];
  // Free text sits on the canvas itself, so ink follows the theme's text colour.
  const fontSize = o.fontSize ?? defaultFontSize(o.type);
  const textColor =
    o.type === "text" ? (o.color === "ink" ? "var(--text)" : STROKE[o.color]) : o.color === "ink" ? "#fafafa" : "#1f1f1f";

  return (
    <g data-id={o.id}>
      {o.type === "ellipse" ? (
        <ellipse cx={o.x + o.w / 2} cy={o.y + o.h / 2} rx={o.w / 2} ry={o.h / 2} fill={fill} stroke={stroke} strokeWidth={2} />
      ) : (
        <rect
          x={o.x}
          y={o.y}
          width={o.w}
          height={o.h}
          rx={o.type === "sticky" ? 4 : 10}
          fill={fill}
          stroke={stroke}
          strokeWidth={2}
          style={o.type === "sticky" ? { filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 0.12))" } : undefined}
        />
      )}
      <foreignObject x={o.x} y={o.y} width={o.w} height={o.h}>
        {editing ? (
          <TextEditor initial={o.text} color={textColor} align={o.type === "sticky" ? "left" : "center"} fontSize={fontSize} bold={o.type === "text"} onChange={onCommitText} onDone={onDoneEditing} />
        ) : (
          <div
            className={cn(
              "flex size-full overflow-hidden p-3 leading-snug break-words whitespace-pre-wrap",
              o.type === "sticky" ? "items-start text-left text-[15px]" : "items-center justify-center text-center",
              o.type === "text" && "font-medium",
            )}
            style={{ color: textColor, fontSize, fontFamily: o.type === "sticky" ? "var(--font-sans)" : undefined }}
          >
            {o.text}
          </div>
        )}
      </foreignObject>
      {outline ? (
        <rect x={o.x - 3 / zoom} y={o.y - 3 / zoom} width={o.w + 6 / zoom} height={o.h + 6 / zoom} rx={8} fill="none" stroke={outline} strokeWidth={sw} pointerEvents="none" />
      ) : null}
    </g>
  );
}

function TextEditor({
  initial,
  color,
  align,
  fontSize,
  bold,
  onChange,
  onDone,
}: {
  initial: string;
  color: string;
  align: "left" | "center";
  fontSize: number;
  bold: boolean;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const flush = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    onChange(v);
  };
  // Focus after the pointer sequence that created the object has settled.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <textarea
      ref={ref}
      autoFocus
      aria-label="Edit text"
      value={value}
      maxLength={5000}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onChange(v), 200);
      }}
      onBlur={() => {
        flush(value);
        onDone();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          flush(value);
          onDone();
        }
      }}
      className={cn("size-full resize-none bg-transparent p-3 leading-snug outline-none", bold && "font-medium")}
      style={{ color, fontSize, textAlign: align }}
    />
  );
}
