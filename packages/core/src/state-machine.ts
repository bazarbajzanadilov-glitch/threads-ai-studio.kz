import type { ContentState } from "./types.js";

export const AUTO_PAUSABLE_STATES = [
  "draft",
  "scheduled",
  "publishing"
] as const satisfies readonly ContentState[];

export function autoPausableState(state: ContentState): boolean {
  return (AUTO_PAUSABLE_STATES as readonly ContentState[]).includes(state);
}

const transitions: Readonly<Record<ContentState, readonly ContentState[]>> = {
  draft: ["scheduled", "paused", "publishing", "failed"],
  scheduled: ["publishing", "paused", "failed", "draft"],
  publishing: ["published", "failed", "paused", "scheduled"],
  published: [],
  paused: ["scheduled", "draft", "publishing", "failed"],
  failed: ["scheduled", "draft", "publishing", "paused"]
};

export function canTransition(from: ContentState, to: ContentState): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function assertTransition(from: ContentState, to: ContentState): void {
  if (!canTransition(from, to)) throw new Error(`Invalid content state transition: ${from} -> ${to}`);
}

export function editableState(state: ContentState): boolean {
  return !["published", "publishing"].includes(state);
}

export interface ContentStateCapabilities {
  canEdit: boolean;
  canPause: boolean;
  canResume: boolean;
  canDelete: boolean;
  canPublishNow: boolean;
}

export function contentStateCapabilities(state: ContentState): ContentStateCapabilities {
  const canEdit = editableState(state);
  const canPublishNow = state !== "published" && state !== "publishing";
  return {
    canEdit,
    canPause: state === "scheduled" || state === "draft",
    canResume: state === "paused",
    canDelete: state !== "publishing",
    canPublishNow
  };
}

export function transitionsFrom(state: ContentState): readonly ContentState[] {
  return transitions[state] ?? [];
}
