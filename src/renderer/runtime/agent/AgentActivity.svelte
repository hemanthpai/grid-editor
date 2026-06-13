<script lang="ts">
  import { MoltenPushButton } from "@intechstudio/grid-uikit";
  import MoltenModal from "../../main/modals/MoltenModal.svelte";
  import { Modal } from "../../main/modals/modal.store";
  import {
    agent_activity,
    type AgentActivityKind,
  } from "./agent-activity.store";

  export let data: Modal.Instance;

  const KIND_LABEL: Record<AgentActivityKind, string> = {
    "write-proposed": "proposed write",
    "write-applied": "applied write",
    "write-rejected": "rejected write",
    "write-failed": "failed write",
    "exec-proposed": "proposed run",
    "exec-run": "ran on device",
    "exec-rejected": "rejected run",
    "exec-failed": "failed run",
  };

  function fmt(t: number): string {
    return new Date(t).toLocaleTimeString();
  }
</script>

<MoltenModal {data}>
  <div slot="content" class="w-[36rem] max-w-full">
    <p class="text-lg font-medium">AI agent activity</p>
    {#if $agent_activity.length === 0}
      <p class="pt-2 text-sm opacity-70">No agent activity yet.</p>
    {:else}
      <ul class="mt-2 flex max-h-96 flex-col gap-1 overflow-auto">
        {#each [...$agent_activity].reverse() as e}
          <li class="border-b border-white/10 py-1 text-sm">
            <span class="opacity-60">{fmt(e.time)}</span>
            <span class="font-medium">{KIND_LABEL[e.kind] ?? e.kind}</span>
            — {e.target}
            {#if e.detail}<span class="opacity-70"> — {e.detail}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    <div class="flex justify-end pt-3">
      <MoltenPushButton
        click={() => data.close()}
        text={"Close"}
        style={"normal"}
      />
    </div>
  </div>
</MoltenModal>
