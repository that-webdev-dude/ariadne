# Phase 6 benchmark

This harness compares the same frozen debugging task under two conditions:

- `control`: normal repository navigation tools only;
- `ariadne`: the same tools plus Ariadne's five MCP queries.

The harness records experiment inputs, converts Codex JSONL into controlled
traces, and scores completed runs. It does not launch an agent or change
Ariadne's index, query, MCP, or runtime code.

The runner is frozen to Codex CLI 0.146.1, `gpt-5.6-sol`, and high reasoning.
Both conditions receive the same conditional instruction. When Ariadne is
available, `ari.repo_overview` must precede source/search navigation and Ariadne
must be used for initial navigation; the control condition receives no Ariadne
tools. The normalizer enforces this efficacy precondition.

## Run protocol

1. Create a fresh target worktree at the commit in `task.manifest.json` for
   every run. Do not expose this benchmark directory or the diagnosis rubric to
   the agent.
2. Use the shared model, instructions, limits, and standard tools in
   `run-configs.json`. The treatment condition adds only the five Ariadne tools.
3. For treatment runs, build Ariadne at the frozen commit, index the fresh
   target worktree, and exclude `.ari/**` from normal repository tools.
4. Launch Codex through the timestamping adapter and preserve that raw capture
   unchanged. Pass the Codex executable and frozen arguments after `--`:

```powershell
npm.cmd run benchmark:trace -- capture raw.jsonl -- <codex-executable> <frozen-exec-arguments> --json
```

   Do not pipe Codex through Windows PowerShell: it can buffer native output and
   invalidate elapsed times. On an npm installation, `<codex-executable>` may be
   `node` followed by the installed `@openai/codex/bin/codex.js` path.

5. Normalize the capture for its assigned condition:

```powershell
npm.cmd run benchmark:trace -- normalize raw.jsonl <run-id> <control-or-ariadne> trace.json
```

   The normalizer accepts only the frozen navigation commands and condition's
   MCP tools. It rejects edits, verification commands, web searches, malformed
   final diagnoses, incomplete calls, failed turns, and limit overruns.
   Context items contain the exact text returned to the model.
6. Stop timing when the agent submits its diagnosis. Do not let either
   condition edit files or run verification commands.
7. Give only the final diagnosis to an evaluator who does not know the
   condition. Record criterion points using `diagnosis-rubric.json`.
8. Analyze one file containing `{ "runs": [...] }` in the same shape as
   `fixtures/sample-results.json`:

```sh
npm run benchmark -- benchmark/phase6/fixtures/sample-results.json
```

The command emits a Markdown run table and A/B aggregate. Replace the sample
with real traces; sample numbers are fixture data, not benchmark evidence.

## Accounting rules

- Tool calls are counted once from each `tool_call` event.
- Repository searches, source reads, and Ariadne calls come from the call's
  declared category.
- Source files are unique source-context paths. Source lines, characters, and
  tokens are gross context loaded, so repeated reads count again.
- Total context includes every exact context item returned by tools.
- Token totals are reported only when every relevant item includes a tokenizer
  count; otherwise they are `n/a`.
- Whole-run model input, cached input, output, and reasoning-output tokens come
  directly from Codex's completed-turn usage event. They are not substituted
  for exact source/context token accounting.
- Time to resolution is the final event's monotonic `elapsedMs`.
- Diagnosis scores are deterministic sums of blinded evaluator points. The
  analyzer rejects missing, extra, or out-of-range criteria.
- The manifest SHA-256 uses UTF-8 text with CRLF normalized to LF so the frozen
  identity is stable across operating systems.

Use at least three interleaved repetitions per condition. Preserve raw traces,
assessments, manifest hash, commits, and run order with the final report.
