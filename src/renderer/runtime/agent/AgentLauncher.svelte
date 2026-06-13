<script lang="ts">
  import { Modal } from "../../main/modals/modal.store";
  import AgentActivity from "./AgentActivity.svelte";
  import { agent_activity } from "./agent-activity.store";

  // "Ask the agent" affordance: a small launcher that opens the activity feed.
  function open() {
    new Modal.Window(AgentActivity).show();
  }
</script>

<button class="agent-launcher" on:click={open} title="AI agent activity">
  🤖 Agent{#if $agent_activity.length}<span class="badge"
      >{$agent_activity.length}</span
    >{/if}
</button>

<style>
  .agent-launcher {
    position: fixed;
    bottom: 12px;
    right: 12px;
    z-index: 40;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 12px;
    color: white;
    background: rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.2);
    cursor: pointer;
  }
  .agent-launcher:hover {
    background: rgba(0, 0, 0, 0.85);
  }
  .badge {
    background: rgba(255, 255, 255, 0.18);
    border-radius: 999px;
    padding: 0 6px;
    font-variant-numeric: tabular-nums;
  }
</style>
