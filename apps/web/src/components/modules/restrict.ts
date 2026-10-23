import type { Modifier } from "@dnd-kit/core";

/** Keep vertical lists from drifting sideways while dragging. */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
