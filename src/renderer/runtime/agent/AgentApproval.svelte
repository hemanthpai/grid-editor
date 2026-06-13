<script lang="ts">
  import { MoltenPushButton } from "@intechstudio/grid-uikit";
  import MoltenModal from "../../main/modals/MoltenModal.svelte";
  import { Modal } from "../../main/modals/modal.store";
  import { onDestroy } from "svelte";

  // Provided by Modal.Window.show():
  export let data: Modal.Instance;
  export let request: {
    targetLabel: string;
    oldScript: string;
    newScript: string;
    warnings: string[];
  };
  // Called with the human's decision.
  export let decide: (approved: boolean) => void;
  // Called if the dialog closes without an explicit decision (escape / click-out).
  export let onClosed: () => void = () => {};

  let acted = false;

  function approve() {
    acted = true;
    decide(true);
    data.close();
  }
  function reject() {
    acted = true;
    decide(false);
    data.close();
  }

  onDestroy(() => {
    if (!acted) onClosed();
  });
</script>

<MoltenModal {data}>
  <div slot="content" class="w-[40rem] max-w-full">
    <p class="text-lg font-medium">AI agent wants to write a script</p>
    <p class="pt-1 text-sm opacity-70">{request.targetLabel}</p>

    {#if request.warnings.length}
      <div
        class="mt-3 rounded border border-yellow-500/50 bg-yellow-500/10 p-2 text-sm"
      >
        <p class="font-medium">Scope warnings</p>
        <ul class="list-disc pl-5">
          {#each request.warnings as w}
            <li>{w}</li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="mt-3 flex flex-col gap-3">
      <div>
        <p class="text-xs uppercase opacity-60">Current</p>
        <pre
          class="max-h-40 overflow-auto rounded bg-black/30 p-2 text-xs whitespace-pre-wrap">{request.oldScript ||
            "(empty)"}</pre>
      </div>
      <div>
        <p class="text-xs uppercase opacity-60">Proposed</p>
        <pre
          class="max-h-40 overflow-auto rounded bg-black/30 p-2 text-xs whitespace-pre-wrap">{request.newScript}</pre>
      </div>
    </div>

    <div class="flex flex-row justify-end pt-3 items-center gap-2">
      <MoltenPushButton click={reject} text={"Reject"} style={"normal"} />
      <MoltenPushButton
        click={approve}
        text={"Approve & apply"}
        style={"accept"}
      />
    </div>
  </div>
</MoltenModal>
