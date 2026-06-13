import type { DebateListState, DebateRole } from "./repository";

export function stateBadge(state: DebateListState, role: DebateRole): { label: string; classes: string } {
  if (state === "in_progress") {
    return {
      label: "In progress",
      classes: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    };
  }
  if (state === "awaiting") {
    return {
      label: role === "advocate" ? "Awaiting response" : "Invitation — respond",
      classes: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    };
  }
  if (state === "drafting") {
    return {
      label: "Drafting",
      classes: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
    };
  }
  // closed
  return {
    label: "Closed",
    classes: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  };
}

export function stateRank(state: DebateListState): number {
  switch (state) {
    case "in_progress":
      return 0;
    case "awaiting":
      return 1;
    case "drafting":
      return 2;
    case "closed":
      return 3;
  }
}
