# AI agent overlay

This fork adds a small **AI agent bridge** to the Grid Editor so the external
[`package-ai-agent`](https://github.com/hemanthpai/package-ai-agent) MCP server
can answer read-only runtime queries (config tree, scoped function reference,
script validation, debug/error logs). See that repo for the full picture.

## What the overlay is

A **thin overlay** on top of upstream `intechstudio/grid-editor` `stable`:

| File | Change |
|---|---|
| `src/renderer/App.svelte` | + import and an `agent-bridge-ready` case in the package message dispatch |
| `src/renderer/runtime/agent/agent-bridge.ts` | new — request/response server over the package MessagePort |
| `src/renderer/runtime/agent/validate.ts` | new — shared intech_lua validator |
| `src/renderer/runtime/agent/grid-context.ts` | new — scope-aware function reference |

Three of the four files are brand new, so they can never conflict with
upstream. The only edited file is `App.svelte`, and the edit is two small
context-anchored insertions.

## Branch model

- **`ai-agent-bridge`** (this fork's default branch) = `upstream/stable` + the
  overlay. This is the branch to clone and build.
- **`stable`** mirrors upstream.
- The overlay's source of truth is **`.ai-agent/bridge.patch`**. The branch is
  rebuilt from `upstream/stable` + that patch, so its history is rebased onto
  upstream on every sync (expect force-pushes — don't base long-lived work
  directly on it; branch off and rebase, or edit the overlay + regenerate the
  patch).

## Staying current with upstream

`.github/workflows/sync-upstream.yml` runs weekly (and on demand):

1. Fetch `upstream/stable`. If nothing new, stop.
2. Rebuild the overlay: check out `upstream/stable`, re-apply `bridge.patch`
   with a **3-way merge** (`git apply --3way`). New files always apply; the
   `App.svelte` hunk auto-merges as long as its anchor context is intact —
   that's the "auto-fix conflicts when possible" path.
3. Decide:
   - **applies + builds** → force-push `ai-agent-bridge` (fully automatic).
   - **applies but build fails** → open a PR for review (branch untouched).
   - **can't apply** (upstream moved our anchor) → open an issue; branch
     untouched.

## Editing the overlay

```bash
# edit App.svelte / src/renderer/runtime/agent/*
bash .ai-agent/regenerate-patch.sh   # refresh bridge.patch
git add -A && git commit -m "ai-agent: <change>"
```
