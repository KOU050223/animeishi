import type { MeishiDocument } from "./types";

const HISTORY_LIMIT = 50;

export type History = {
  past: MeishiDocument[];
  future: MeishiDocument[];
};

export function emptyHistory(): History {
  return { past: [], future: [] };
}

export function commit(history: History, previous: MeishiDocument): History {
  const past = [...history.past, previous];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, future: [] };
}

export function undo(
  history: History,
  current: MeishiDocument,
): { history: History; doc: MeishiDocument } | null {
  if (history.past.length === 0) return null;
  const past = [...history.past];
  const previous = past.pop()!;
  return {
    history: { past, future: [...history.future, current] },
    doc: previous,
  };
}

export function redo(
  history: History,
  current: MeishiDocument,
): { history: History; doc: MeishiDocument } | null {
  if (history.future.length === 0) return null;
  const future = [...history.future];
  const next = future.pop()!;
  return {
    history: { past: [...history.past, current], future },
    doc: next,
  };
}
