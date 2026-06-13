#!/usr/bin/env bash
#
# Regenerate .ai-agent/bridge.patch from the current overlay vs upstream/stable.
#
# The AI-agent integration is maintained as a thin OVERLAY on top of upstream
# (intechstudio/grid-editor) `stable`. The canonical definition of that overlay
# is this patch; the `ai-agent-bridge` branch is just `upstream/stable` + this
# patch applied. The sync workflow rebuilds the branch from those two inputs.
#
# Run this after editing any overlay file (App.svelte hook or the
# src/renderer/runtime/agent/* files), then commit the updated patch.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream https://github.com/intechstudio/grid-editor.git
fi
git fetch upstream stable

# Intent-to-add any new (untracked) overlay files so git diff includes them.
git add -N src/renderer/runtime/agent 2>/dev/null || true

git diff upstream/stable -- \
  src/renderer/App.svelte \
  src/renderer/runtime/agent \
  > .ai-agent/bridge.patch

echo "Wrote .ai-agent/bridge.patch:"
git apply --stat .ai-agent/bridge.patch
