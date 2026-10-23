"use client";

import "@xyflow/react/dist/style.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { toast } from "sonner";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { GitBranchPlus, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import { roomName } from "@collabverse/shared";
import {
  MINDMAP_COLORS,
  MINDMAP_ROOT_ID,
  addChildNode,
  deleteNode,
  nodesMap,
  normalizeMindmap,
  readMindmap,
  reparentNode,
  updateNode,
  type MindmapColor,
  type MindmapNodeData,
} from "@collabverse/shared/mindmap";
import { useCollabRoom, useCollaborators } from "@/lib/collab/react";
import type { CollabSession, Collaborator } from "@/lib/collab/types";
import { useWorkspace } from "@/lib/workspace-context";
import type { ItemRow } from "@/lib/data/items";
import { CollabGate, CollabHeader, useLiveItem } from "@/components/modules/collab-chrome";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/menu";
import { Kbd } from "@/components/ui/misc";
import { cn, colorVar } from "@/lib/utils";
import { childPosition, tidyLayout } from "./layout";

interface MindNodeData extends Record<string, unknown> {
  label: string;
  color: MindmapColor;
  isRoot: boolean;
  editable: boolean;
  editing: boolean;
  remote: { name: string; color: string; editing: boolean } | null;
  onRename: (label: string) => void;
  onStopEditing: () => void;
  onAddChild: () => void;
}

type MindNode = Node<MindNodeData, "mind">;

export function Mindmap({ map }: { map: ItemRow }) {
  const { session, state } = useCollabRoom(roomName("mindmap", map.id));
  const { item, deleted } = useLiveItem("mindmap", map);
  return (
    <div className="flex h-full flex-col">
      <CollabHeader module="mindmap" item={item} session={session} state={state} />
      <CollabGate state={state} deleted={deleted} module="mindmap">
        {session ? (
          <ReactFlowProvider>
            <MindmapCanvas key={session.room} session={session} readOnly={state.access !== "read-write"} />
          </ReactFlowProvider>
        ) : null}
      </CollabGate>
    </div>
  );
}

function useMindmapData(doc: Y.Doc) {
  const [data, setData] = useState(() => normalizeMindmap(readMindmap(doc)));
  useEffect(() => {
    const m = nodesMap(doc);
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setData(normalizeMindmap(readMindmap(doc))));
    };
    m.observeDeep(update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      m.unobserveDeep(update);
    };
  }, [doc]);
  return data;
}

function MindmapCanvas({ session, readOnly }: { session: CollabSession; readOnly: boolean }) {
  const { canEdit } = useWorkspace();
  const editable = canEdit && !readOnly;
  const doc = session.doc;
  const { nodes: model, edges: modelEdges } = useMindmapData(doc);
  const collaborators = useCollaborators(session.awareness);
  const flow = useReactFlow<MindNode>();
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rfNodes, setRfNodes] = useState<MindNode[]>([]);
  const dragging = useRef<Set<string>>(new Set());
  const wrapper = useRef<HTMLDivElement>(null);
  const undo = useMemo(() => new Y.UndoManager(nodesMap(doc), { captureTimeout: 500 }), [doc]);
  useEffect(() => () => undo.destroy(), [undo]);

  useEffect(() => {
    session.awareness.setLocalStateField("selection", selected);
    session.awareness.setLocalStateField("editing", editingId);
  }, [selected, editingId, session.awareness]);

  const remoteByNode = useMemo(() => {
    const map = new Map<string, { name: string; color: string; editing: boolean }>();
    for (const c of collaborators) {
      const st = session.awareness.getStates().get(c.clientId) as { selection?: unknown; editing?: unknown } | undefined;
      if (typeof st?.editing === "string") map.set(st.editing, { name: c.user.name, color: c.user.color, editing: true });
      if (Array.isArray(st?.selection)) {
        for (const id of st.selection) if (typeof id === "string" && !map.has(id)) map.set(id, { name: c.user.name, color: c.user.color, editing: false });
      }
    }
    return map;
  }, [collaborators, session.awareness]);

  const addChild = useCallback(
    (parentId: string) => {
      const current = normalizeMindmap(readMindmap(doc)).nodes;
      const pos = childPosition(current, parentId);
      try {
        const id = addChildNode(doc, parentId, { label: "New idea", ...pos });
        setSelected([id]);
        setEditingId(id);
      } catch {
        // The parent was deleted by someone else a moment ago.
        toast.error("That topic no longer exists. Pick another one and try again.");
      }
    },
    [doc],
  );

  // Rebuild React Flow nodes from the shared model, keeping local drag positions.
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return model.map<MindNode>((n) => {
        const p = prevById.get(n.id);
        const position = dragging.current.has(n.id) && p ? p.position : { x: n.x, y: n.y };
        return {
          id: n.id,
          type: "mind",
          position,
          selected: selected.includes(n.id),
          draggable: editable,
          data: {
            label: n.label,
            color: n.color,
            isRoot: n.id === MINDMAP_ROOT_ID,
            editable,
            editing: editingId === n.id,
            remote: remoteByNode.get(n.id) ?? null,
            onRename: (label: string) => updateNode(doc, n.id, { label }),
            onStopEditing: () => setEditingId(null),
            onAddChild: () => addChild(n.id),
          },
        };
      });
    });
  }, [model, selected, editingId, editable, remoteByNode, doc, addChild]);

  const edges: Edge[] = useMemo(
    () =>
      modelEdges.map((e) => {
        const target = model.find((n) => n.id === e.target);
        return { id: e.id, source: e.source, target: e.target, style: { stroke: colorVar(target?.color), strokeWidth: 2, opacity: 0.7 } };
      }),
    [modelEdges, model],
  );

  const frame = useRef(0);
  const pending = useRef<Record<string, { x: number; y: number }>>({});
  const writePositions = (positions: Record<string, { x: number; y: number }>, immediate = false) => {
    Object.assign(pending.current, positions);
    const run = () => {
      frame.current = 0;
      const p = pending.current;
      pending.current = {};
      doc.transact(() => {
        for (const [id, pos] of Object.entries(p)) updateNode(doc, id, { x: Math.round(pos.x), y: Math.round(pos.y) });
      });
    };
    if (immediate) {
      cancelAnimationFrame(frame.current);
      run();
    } else if (!frame.current) frame.current = requestAnimationFrame(run);
  };

  const onNodesChange = (changes: NodeChange<MindNode>[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
    const moves: Record<string, { x: number; y: number }> = {};
    let finished = false;
    for (const c of changes) {
      if (c.type === "position" && c.position && editable) {
        if (c.dragging) dragging.current.add(c.id);
        else {
          dragging.current.delete(c.id);
          finished = true;
        }
        moves[c.id] = c.position;
      }
      if (c.type === "select") {
        setSelected((s) => (c.selected ? (s.includes(c.id) ? s : [...s, c.id]) : s.filter((x) => x !== c.id)));
      }
    }
    if (Object.keys(moves).length) writePositions(moves, finished);
  };

  const onNodeDragStop = (_: unknown, node: MindNode) => {
    dragging.current.delete(node.id);
    if (!editable || node.id === MINDMAP_ROOT_ID) return;
    // Dropping a node onto another makes it that node's child.
    const target = flow.getIntersectingNodes(node).find((n) => n.id !== node.id);
    if (!target) return;
    const current = model.find((n) => n.id === node.id);
    if (current?.parentId === target.id) return;
    if (reparentNode(doc, node.id, target.id)) {
      const pos = childPosition(normalizeMindmap(readMindmap(doc)).nodes.filter((n) => n.id !== node.id), target.id);
      updateNode(doc, node.id, pos);
      toast.success(`Moved under “${target.data.label}”`);
    } else {
      toast.error("A topic can't be moved inside its own branch.");
    }
  };

  const removeSelected = () => {
    const ids = selected.filter((id) => id !== MINDMAP_ROOT_ID);
    if (!ids.length) return;
    doc.transact(() => {
      for (const id of ids) deleteNode(doc, id);
    });
    // Keep the central topic selected so Child / Tab work straight away.
    setSelected([MINDMAP_ROOT_ID]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!editable || editingId) return;
    // Keys pressed on toolbar buttons and inputs belong to those controls.
    if ((e.target as HTMLElement).closest("button, input, textarea, select, [role=toolbar]")) return;

    const mod = e.metaKey || e.ctrlKey;
    const one = selected.length === 1 ? selected[0]! : null;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) undo.redo();
      else undo.undo();
    } else if (e.key === "Tab" && selected.length <= 1) {
      e.preventDefault();
      addChild(one ?? MINDMAP_ROOT_ID);
    } else if (e.key === "Enter" && one) {
      e.preventDefault();
      const parent = model.find((n) => n.id === one)?.parentId;
      addChild(parent ?? one);
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
      e.preventDefault();
      removeSelected();
    } else if (e.key === "F2" && one) {
      e.preventDefault();
      setEditingId(one);
    }
  };

  const setColor = (c: MindmapColor) => {
    doc.transact(() => {
      for (const id of selected) updateNode(doc, id, { color: c });
    });
  };

  const tidy = () => {
    const pos = tidyLayout(model);
    doc.transact(() => {
      for (const [id, p] of Object.entries(pos)) updateNode(doc, id, p);
    });
    requestAnimationFrame(() => void flow.fitView({ padding: 0.2, duration: 300 }));
  };

  const lastCursor = useRef(0);
  const onPointerMove = (e: React.PointerEvent) => {
    const now = performance.now();
    if (now - lastCursor.current < 40) return;
    lastCursor.current = now;
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    session.awareness.setLocalStateField("cursor", { x: Math.round(p.x), y: Math.round(p.y) });
  };

  return (
    <div
      ref={wrapper}
      className="relative min-h-0 flex-1"
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => session.awareness.setLocalStateField("cursor", null)}
    >
      <ReactFlow<MindNode>
        nodes={rfNodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={(_, n) => editable && setEditingId(n.id)}
        nodesDraggable={editable}
        nodesConnectable={false}
        elementsSelectable
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
        minZoom={0.15}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border-strong)" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap pannable zoomable position="bottom-left" nodeColor={(n) => colorVar((n.data as MindNodeData).color)} maskColor="rgb(0 0 0 / 0.05)" />
        <ViewportPortal>
          <RemoteCursors collaborators={collaborators} />
        </ViewportPortal>
      </ReactFlow>

      {editable ? (
        <div role="toolbar" aria-label="Mindmap tools" className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-md">
          <Tooltip label={<span className="flex items-center gap-2">Add child <Kbd>Tab</Kbd></span>}>
            <Button size="sm" variant="ghost" disabled={selected.length > 1} onClick={() => addChild(selected[0] ?? MINDMAP_ROOT_ID)}>
              <Plus className="size-4" /> Child
            </Button>
          </Tooltip>
          <Tooltip label={<span className="flex items-center gap-2">Add sibling <Kbd>Enter</Kbd></span>}>
            <Button
              size="sm"
              variant="ghost"
              disabled={selected.length !== 1 || selected[0] === MINDMAP_ROOT_ID}
              onClick={() => {
                const parent = model.find((n) => n.id === selected[0])?.parentId;
                if (parent) addChild(parent);
              }}
            >
              <GitBranchPlus className="size-4" /> Sibling
            </Button>
          </Tooltip>
          <span className="mx-1 h-5 w-px bg-border" />
          {MINDMAP_COLORS.map((c) => (
            <button
              key={c}
              aria-label={`Colour ${c}`}
              disabled={!selected.length}
              onClick={() => setColor(c)}
              className="size-5 rounded-full transition-transform enabled:hover:scale-110 disabled:opacity-30"
              style={{ background: colorVar(c) }}
            />
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <Tooltip label="Tidy layout">
            <Button size="icon-sm" variant="ghost" aria-label="Tidy layout" onClick={tidy}>
              <LayoutTemplate className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip label={<span className="flex items-center gap-2">Delete branch <Kbd>Del</Kbd></span>}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Delete branch"
              className="text-danger hover:bg-danger-soft"
              disabled={!selected.some((id) => id !== MINDMAP_ROOT_ID)}
              onClick={removeSelected}
            >
              <Trash2 className="size-4" />
            </Button>
          </Tooltip>
        </div>
      ) : null}

      {editable && model.length <= 1 ? (
        <p className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 rounded-lg bg-surface/90 px-3 py-1.5 text-[13px] text-muted shadow-sm">
          Click <span className="font-medium text-text">Child</span> or press <Kbd>Tab</Kbd> to add an idea.
        </p>
      ) : null}
    </div>
  );
}

function RemoteCursors({ collaborators }: { collaborators: Collaborator[] }) {
  const { zoom } = useViewport();
  return (
    <>
      {collaborators.map((c) => {
        const cur = c.cursor as { x?: number; y?: number } | null | undefined;
        if (!cur || typeof cur.x !== "number" || typeof cur.y !== "number") return null;
        return (
          <div
            key={c.clientId}
            className="pointer-events-none absolute top-0 left-0"
            style={{ transform: `translate(${cur.x}px, ${cur.y}px) scale(${1 / zoom})`, transformOrigin: "0 0", transition: "transform 80ms linear" }}
          >
            <svg width="20" height="22" viewBox="0 0 20 22" aria-hidden>
              <path d="M0 0 L0 16 L4.5 12 L7.5 19 L10 18 L7 11 L13 11 Z" fill={c.user.color} stroke="white" strokeWidth={1.2} />
            </svg>
            <span className="ml-3 rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white" style={{ background: c.user.color }}>
              {c.user.name}
            </span>
          </div>
        );
      })}
    </>
  );
}

const MindNodeView = memo(function MindNodeView({ data, selected }: NodeProps<MindNode>) {
  const [value, setValue] = useState(data.label);
  useEffect(() => {
    if (!data.editing) setValue(data.label);
  }, [data.label, data.editing]);
  const accent = colorVar(data.color);
  const ring = selected ? "var(--accent)" : data.remote?.color;

  return (
    <div className="group relative">
      <Handle type="target" position={Position.Left} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
      <div
        className={cn(
          "min-w-28 max-w-64 rounded-xl border bg-surface px-3.5 py-2 shadow-sm transition-shadow",
          data.isRoot ? "border-transparent px-5 py-3 text-[16px] font-semibold text-white shadow-md" : "border-border text-[14px] text-text",
        )}
        style={{
          background: data.isRoot ? accent : undefined,
          borderLeft: data.isRoot ? undefined : `3px solid ${accent}`,
          boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
        }}
      >
        {data.editing ? (
          <input
            autoFocus
            aria-label="Topic"
            value={value}
            maxLength={200}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => {
              data.onRename(value.trim() || data.label);
              data.onStopEditing();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" || e.key === "Escape") {
                if (e.key === "Enter") data.onRename(value.trim() || data.label);
                data.onStopEditing();
              }
            }}
            className="nodrag w-full bg-transparent outline-none"
          />
        ) : (
          <span className="block break-words">{data.label || "Untitled"}</span>
        )}
      </div>
      {data.remote ? (
        <span className="absolute -top-5 left-1 rounded px-1.5 text-[10.5px] font-semibold whitespace-nowrap text-white" style={{ background: data.remote.color }}>
          {data.remote.name}
          {data.remote.editing ? " is editing" : ""}
        </span>
      ) : null}
      {data.editable && !data.editing ? (
        <button
          aria-label="Add child topic"
          onClick={(e) => {
            e.stopPropagation();
            data.onAddChild();
          }}
          className="nodrag absolute top-1/2 -right-3 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-text-2 opacity-0 shadow-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-accent focus:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <Plus className="size-3.5" />
        </button>
      ) : null}
      <Handle type="source" position={Position.Right} className="!size-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
    </div>
  );
});

const NODE_TYPES = { mind: MindNodeView };

export type { MindmapNodeData };
