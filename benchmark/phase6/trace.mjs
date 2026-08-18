import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { hashManifest } from "./analyze.mjs";

const CAPTURE_VERSION = 1;
const ARIADNE_TOOLS = new Set([
  "ari.repo_overview",
  "ari.find_symbol",
  "ari.describe_symbol",
  "ari.dependencies",
  "ari.dependents",
]);

export async function stampCodexJsonl(input = process.stdin, output = process.stdout) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  output.write(`${JSON.stringify({ type: "capture.started", captureVersion: CAPTURE_VERSION, startedAt })}\n`);

  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error("Codex emitted a non-JSON line");
    }
    output.write(`${JSON.stringify({
      type: "codex.event",
      elapsedMs: Math.round(performance.now() - started),
      event,
    })}\n`);
  }
}

export async function captureCommand(outputPath, command, args) {
  const output = createWriteStream(resolve(outputPath), { encoding: "utf8" });
  const child = spawn(command, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const stamped = stampCodexJsonl(child.stdout, output);
  let exitCode;
  try {
    [exitCode] = await once(child, "exit");
    await stamped;
  } finally {
    output.end();
    await finished(output);
  }
  if (exitCode !== 0) throw new Error(`Codex exited with code ${exitCode}`);
}

export function normalizeCapture(content, options) {
  const { runId, condition, manifest, runConfigs, manifestSha256 } = options;
  if (!runId || (condition !== "control" && condition !== "ariadne")) {
    throw new Error("normalize requires a run id and condition: control or ariadne");
  }

  const records = content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => parseJson(line, `capture line ${index + 1}`));
  const header = records.shift();
  if (
    header?.type !== "capture.started" ||
    header.captureVersion !== CAPTURE_VERSION ||
    Number.isNaN(Date.parse(header.startedAt))
  ) {
    throw new Error("capture is missing a valid capture.started header");
  }

  const allowedMcpTools = new Set(
    runConfigs.conditions?.[condition]?.additionalTools ?? [],
  );
  const events = [];
  const pending = new Map();
  let previousElapsedMs = -1;
  let finalMessage = null;
  let usage = null;
  let completedElapsedMs = null;

  const emit = (elapsedMs, event) => {
    events.push({ sequence: events.length + 1, elapsedMs, ...event });
  };

  for (const record of records) {
    if (
      record?.type !== "codex.event" ||
      !Number.isInteger(record.elapsedMs) ||
      record.elapsedMs < previousElapsedMs ||
      !record.event ||
      typeof record.event !== "object"
    ) {
      throw new Error("capture records must be monotonic stamped Codex events");
    }
    previousElapsedMs = record.elapsedMs;
    const event = record.event;

    if (event.type === "error" || event.type === "turn.failed") {
      throw new Error(`Codex run failed: ${stringifyValue(event.message ?? event.error ?? event)}`);
    }
    if (event.type === "thread.started" || event.type === "turn.started") continue;

    if (event.type === "item.started") {
      const item = requireItem(event);
      if (item.type === "command_execution") {
        const classified = classifyCommand(item.command);
        startCall(pending, item.id, { kind: "command", ...classified });
        emit(record.elapsedMs, {
          type: "tool_call",
          callId: item.id,
          tool: "shell",
          category: classified.category,
          arguments: { command: item.command },
        });
      } else if (item.type === "mcp_tool_call") {
        const tool = mcpToolName(item);
        if (!ARIADNE_TOOLS.has(tool) || !allowedMcpTools.has(tool)) {
          throw new Error(`MCP tool is not allowed for ${condition}: ${tool}`);
        }
        startCall(pending, item.id, { kind: "mcp", tool });
        emit(record.elapsedMs, {
          type: "tool_call",
          callId: item.id,
          tool,
          category: "ariadne",
          arguments: objectValue(item.arguments ?? item.input ?? {}),
        });
      } else if (isForbiddenItem(item.type)) {
        throw new Error(`unsupported Codex action: ${item.type}`);
      }
      continue;
    }

    if (event.type === "item.completed") {
      const item = requireItem(event);
      if (item.type === "command_execution") {
        const startedCall = completeCall(pending, item.id, "command");
        const output = commandOutput(item);
        emit(record.elapsedMs, {
          type: "tool_result",
          callId: item.id,
          ok: commandSucceeded(item),
          context: [{
            kind: startedCall.category === "source" ? "source" : startedCall.contextKind,
            ...(startedCall.path ? { path: startedCall.path } : {}),
            content: output,
          }],
        });
      } else if (item.type === "mcp_tool_call") {
        completeCall(pending, item.id, "mcp");
        emit(record.elapsedMs, {
          type: "tool_result",
          callId: item.id,
          ok: item.status !== "failed" && item.error == null,
          context: [{ kind: "ariadne_result", content: mcpOutput(item) }],
        });
      } else if (item.type === "agent_message") {
        finalMessage = { elapsedMs: record.elapsedMs, content: requireText(item) };
      } else if (isForbiddenItem(item.type)) {
        throw new Error(`unsupported Codex action: ${item.type}`);
      }
      continue;
    }

    if (event.type === "turn.completed") {
      usage = normalizeUsage(event.usage);
      completedElapsedMs = record.elapsedMs;
      continue;
    }
  }

  if (pending.size > 0) throw new Error("capture has an incomplete tool call");
  if (!finalMessage) throw new Error("capture has no completed agent diagnosis");
  if (!usage || completedElapsedMs === null) throw new Error("capture has no completed turn usage");

  const diagnosis = validateDiagnosis(parseJson(finalMessage.content, "final diagnosis"));
  emit(Math.max(finalMessage.elapsedMs, completedElapsedMs), {
    type: "final",
    content: finalMessage.content,
    diagnosis,
  });

  const toolCalls = events.filter(({ type }) => type === "tool_call").length;
  const firstNavigationCall = events.find(
    ({ type, category }) =>
      type === "tool_call" && ["ariadne", "search", "source"].includes(category),
  );
  if (condition === "ariadne" && firstNavigationCall?.category !== "ariadne") {
    throw new Error("Ariadne treatment must use Ariadne before source or search navigation");
  }
  if (toolCalls > manifest.limits.maxToolCalls) {
    throw new Error(`tool-call limit exceeded: ${toolCalls}`);
  }
  if (events.at(-1).elapsedMs > manifest.limits.wallClockMs) {
    throw new Error(`wall-clock limit exceeded: ${events.at(-1).elapsedMs} ms`);
  }

  return {
    $schema: "./trace.schema.json",
    schemaVersion: 1,
    runId,
    benchmarkId: manifest.benchmarkId,
    condition,
    runConfigId: condition,
    manifestSha256,
    targetCommit: manifest.target.commit,
    ariadneCommit: condition === "ariadne" ? manifest.ariadne.functionalityCommit : null,
    runner: structuredClone(manifest.runner),
    model: {
      provider: manifest.agent.provider,
      id: manifest.agent.model,
      settings: structuredClone(manifest.agent.settings),
    },
    startedAt: header.startedAt,
    usage,
    events,
  };
}

function classifyCommand(command) {
  const script = commandScript(command).trim();
  if (!script || hasShellControl(script)) {
    throw new Error(`command must contain one navigation action: ${script}`);
  }

  const sourceMatch = script.match(
    /^Get-Content\s+-LiteralPath\s+(?:'([^']+)'|"([^"]+)"|([^\s]+))$/i,
  );
  if (sourceMatch) {
    const path = normalizePath(sourceMatch[1] ?? sourceMatch[2] ?? sourceMatch[3]);
    const isSource = /\.(?:[cm]?[jt]sx?)$/i.test(path);
    return {
      category: isSource ? "source" : "other",
      contextKind: isSource ? "source" : "other",
      path,
    };
  }

  if (/^(?:rg|Get-ChildItem|git\s+(?:grep|ls-files))(?:\s|$)/i.test(script)) {
    return { category: "search", contextKind: "search_result" };
  }
  if (/^(?:Get-Location|Resolve-Path|Test-Path|git\s+(?:status|rev-parse))(?:\s|$)/i.test(script)) {
    return { category: "other", contextKind: "other" };
  }
  throw new Error(`unsupported command in controlled run: ${script}`);
}

function commandScript(command) {
  if (typeof command === "string") return unwrapPowerShell(command);
  if (Array.isArray(command) && command.every((part) => typeof part === "string")) {
    return unwrapPowerShell(command.at(-1) ?? "");
  }
  throw new Error("command_execution.command must be a string or string array");
}

function unwrapPowerShell(command) {
  const prefix = command.match(/^"[^"]*powershell\.exe"\s+-Command\s+/i);
  if (!prefix) return command;
  const payload = command.slice(prefix[0].length);
  if (payload.startsWith('"')) {
    try {
      return JSON.parse(payload);
    } catch {
      // Windows may report mixed wrapper quotes for a rejected command.
    }
  }
  return payload.length >= 2 ? payload.slice(1, -1) : payload;
}

function hasShellControl(script) {
  let quote = null;
  for (let index = 0; index < script.length; index += 1) {
    const character = script[index];
    if ((character === "`" || character === "\\") && quote === '"') {
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }
    if (quote === null && ";|<>".includes(character)) return true;
    if (quote === null && character === "&" && script[index + 1] === "&") return true;
  }
  return false;
}

function commandOutput(item) {
  const output = item.aggregated_output ?? item.output ?? item.stdout ?? "";
  return typeof output === "string" ? output : stringifyValue(output);
}

function commandSucceeded(item) {
  const exitCode = item.exit_code ?? item.exitCode;
  return item.status !== "failed" && (exitCode == null || exitCode === 0);
}

function mcpToolName(item) {
  const explicit = item.tool ?? item.name;
  if (typeof explicit !== "string" || !explicit) {
    throw new Error("mcp_tool_call is missing a tool name");
  }
  if (explicit.startsWith("ari.")) return explicit;
  const server = item.server ?? item.server_name;
  return server === "ari" || server === "ariadne" ? `ari.${explicit}` : explicit;
}

function mcpOutput(item) {
  const result = item.result?.Ok ?? item.result ?? item.output ?? "";
  if (typeof result === "string") return result;
  const content = result?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part?.text === "string" ? part.text : stringifyValue(part))
      .join("\n");
  }
  return stringifyValue(result);
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object") throw new Error("turn.completed is missing usage");
  const usage = {
    inputTokens: value.input_tokens ?? value.inputTokens,
    cachedInputTokens: value.cached_input_tokens ?? value.cachedInputTokens ?? 0,
    outputTokens: value.output_tokens ?? value.outputTokens,
    reasoningOutputTokens:
      value.reasoning_output_tokens ?? value.reasoningOutputTokens ?? 0,
  };
  if (Object.values(usage).some((number) => !Number.isInteger(number) || number < 0)) {
    throw new Error("turn.completed usage must contain non-negative token counts");
  }
  return usage;
}

function validateDiagnosis(value) {
  const keys = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  if (keys.join(",") !== "causalChain,evidence,fixBoundary,rootCause") {
    throw new Error("final diagnosis must contain exactly the four required fields");
  }
  for (const key of ["rootCause", "causalChain", "fixBoundary"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) {
      throw new Error(`final diagnosis.${key} must be a non-empty string`);
    }
  }
  if (
    !Array.isArray(value.evidence) ||
    value.evidence.length === 0 ||
    value.evidence.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new Error("final diagnosis.evidence must be a non-empty string array");
  }
  return value;
}

function requireItem(event) {
  const item = event.item;
  if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id) {
    throw new Error(`${event.type} is missing an item id`);
  }
  return item;
}

function startCall(pending, id, value) {
  if (pending.has(id)) throw new Error(`duplicate tool call id: ${id}`);
  pending.set(id, value);
}

function completeCall(pending, id, expectedKind) {
  const value = pending.get(id);
  if (!value || value.kind !== expectedKind) throw new Error(`unmatched tool result: ${id}`);
  pending.delete(id);
  return value;
}

function requireText(item) {
  const text = item.text ?? item.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("completed agent_message is missing text");
  }
  return text;
}

function objectValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tool arguments must be an object");
  }
  return value;
}

function isForbiddenItem(type) {
  return type === "file_change" || type === "web_search";
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function parseJson(content, label) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function stringifyValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "stamp" && args.length <= 1) {
    if (args.length === 0) {
      await stampCodexJsonl();
      return;
    }
    const output = createWriteStream(resolve(args[0]), { encoding: "utf8" });
    try {
      await stampCodexJsonl(process.stdin, output);
    } finally {
      output.end();
    }
    await finished(output);
    return;
  }
  if (mode === "capture" && args.length >= 4 && args[1] === "--") {
    const [outputPath, , command, ...commandArgs] = args;
    await captureCommand(outputPath, command, commandArgs);
    return;
  }
  if (mode === "normalize" && (args.length === 3 || args.length === 4)) {
    const [capturePath, runId, condition, outputPath] = args;
    const manifestPath = resolve(import.meta.dirname, "task.manifest.json");
    const manifestContent = readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);
    const runConfigs = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "run-configs.json"), "utf8"),
    );
    const trace = normalizeCapture(readFileSync(resolve(capturePath), "utf8"), {
      runId,
      condition,
      manifest,
      runConfigs,
      manifestSha256: hashManifest(manifestContent),
    });
    const json = `${JSON.stringify(trace, null, 2)}\n`;
    if (outputPath) writeFileSync(resolve(outputPath), json, "utf8");
    else process.stdout.write(json);
    return;
  }
  throw new Error(
    "Usage: benchmark:trace -- capture <capture.jsonl> -- <command> [args...] | stamp [capture.jsonl] | normalize <capture.jsonl> <run-id> <control|ariadne> [trace.json]",
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`Phase 6 trace: ${error.message}`);
    process.exitCode = 1;
  });
}
