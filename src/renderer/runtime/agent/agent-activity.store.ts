/**
 * In-app activity feed for AI-agent mutations. Every guarded write the agent
 * proposes is logged here (proposed / applied / rejected / failed) so the user
 * has a visible record of what the agent did. The Phase 5 "Ask the agent" panel
 * can render this; for now outcomes also surface as editor toasts.
 */
import { writable } from "svelte/store";

export type AgentActivityKind =
  | "write-proposed"
  | "write-applied"
  | "write-rejected"
  | "write-failed"
  | "exec-proposed"
  | "exec-run"
  | "exec-rejected"
  | "exec-failed";

export interface AgentActivityEntry {
  time: number;
  kind: AgentActivityKind;
  target: string;
  detail?: string;
}

function createActivity(max = 100) {
  const store = writable<AgentActivityEntry[]>([]);
  return {
    ...store,
    log(entry: Omit<AgentActivityEntry, "time">) {
      store.update((entries) => {
        const next = [...entries, { ...entry, time: Date.now() }];
        return next.length > max ? next.slice(-max) : next;
      });
    },
  };
}

export const agent_activity = createActivity();
