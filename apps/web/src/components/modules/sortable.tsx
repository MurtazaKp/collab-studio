"use client";

import type { ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "./restrict";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/** Vertical drag-to-reorder list; reports (id, newIndex) on drop. */
export function SortableList<T extends { id: string }>({
  items,
  disabled,
  onMove,
  render,
  className,
}: {
  items: T[];
  disabled?: boolean;
  onMove: (id: string, toIndex: number) => void;
  render: (item: T, handle: ReactNode, index: number) => ReactNode;
  className?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const to = items.findIndex((i) => i.id === e.over!.id);
    if (to >= 0) onMove(String(e.active.id), to);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis]}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className={className}>
          {items.map((item, index) => (
            <Row key={item.id} id={item.id} disabled={disabled}>
              {(handle) => render(item, handle, index)}
            </Row>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function Row({ id, disabled, children }: { id: string; disabled?: boolean; children: (handle: ReactNode) => ReactNode }) {
  const s = useSortable({ id, disabled });
  const handle = disabled ? null : (
    <button
      {...s.attributes}
      {...s.listeners}
      aria-label="Drag to reorder"
      className="cursor-grab touch-none rounded p-1.5 text-muted opacity-60 transition-opacity hover:bg-surface-2 hover:opacity-100 active:cursor-grabbing"
    >
      <GripVertical className="size-4" />
    </button>
  );
  return (
    <li
      ref={s.setNodeRef}
      style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}
      className={cn("relative", s.isDragging && "z-10 opacity-80 shadow-lg")}
    >
      {children(handle)}
    </li>
  );
}
