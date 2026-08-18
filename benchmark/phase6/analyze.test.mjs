import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import {
  analyzeResults,
  hashManifest,
  renderMarkdown,
  scoreAssessment,
} from "./analyze.mjs";
import { normalizeCapture, stampCodexJsonl } from "./trace.mjs";

const readJson = (path) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, path), "utf8"));

const fixture = readJson("fixtures/sample-results.json");
const rubric = readJson("diagnosis-rubric.json");
const manifestContent = readFileSync(
  resolve(import.meta.dirname, "task.manifest.json"),
  "utf8",
);
const manifest = JSON.parse(manifestContent);
const manifestSha256 = hashManifest(manifestContent);
const runConfigs = readJson("run-configs.json");
const readFixture = (name) =>
  readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8");
const mapCapture = (content, map) =>
  content
    .trimEnd()
    .split("\n")
    .map((line) => JSON.stringify(map(JSON.parse(line))))
    .join("\n");

test("accounts for tool and exact returned context deterministically", () => {
  const analysis = analyzeResults(fixture, rubric, manifest, manifestSha256);
  const control = analysis.rows[0];
  const ariadne = analysis.rows[1];

  assert.deepEqual(
    {
      toolCalls: control.toolCalls,
      searchCalls: control.searchCalls,
      sourceReadCalls: control.sourceReadCalls,
      ariadneCalls: control.ariadneCalls,
      sourceFiles: control.sourceFiles,
      sourceLines: control.sourceLines,
      sourceTokens: control.sourceTokens,
      contextTokens: control.contextTokens,
      modelInputTokens: control.modelInputTokens,
      modelOutputTokens: control.modelOutputTokens,
      resolutionMs: control.resolutionMs,
    },
    {
      toolCalls: 3,
      searchCalls: 1,
      sourceReadCalls: 2,
      ariadneCalls: 0,
      sourceFiles: 2,
      sourceLines: 5,
      sourceTokens: 10,
      contextTokens: 15,
      modelInputTokens: 1200,
      modelOutputTokens: 180,
      resolutionMs: 1000,
    },
  );
  assert.equal(ariadne.sourceLines, 2);
  assert.equal(analysis.comparison.sourceLineReductionPercent, 60);
  assert.equal(analysis.comparison.sourceTokenReductionPercent, 70);
  assert.equal(analysis.comparison.diagnosisQualityPreserved, true);
});

test("scores only exact in-range rubric criteria and enforces accuracy gates", () => {
  assert.deepEqual(
    scoreAssessment(rubric, fixture.runs[0].assessment),
    { total: 10, maximum: 10, pass: true },
  );
  assert.throws(
    () =>
      scoreAssessment(rubric, {
        points: {
          root_cause: 5,
          causal_chain: 3,
          source_evidence: 2,
          fix_boundary: 1,
        },
      }),
    /invalid points for root_cause/,
  );
});

test("renders a stable result table and aggregate comparison", () => {
  const report = renderMarkdown(
    analyzeResults(fixture, rubric, manifest, manifestSha256),
  );

  assert.match(report, /sample-control-01 \| control \| 10\/10 pass/);
  assert.match(report, /Source-line reduction: 60\.0%/);
  assert.match(report, /Diagnosis quality preserved: yes/);
});

test("rejects a trace that drifts from the frozen manifest", () => {
  const drifted = structuredClone(fixture);
  drifted.runs[0].trace.model.id = "different-model";

  assert.throws(
    () => analyzeResults(drifted, rubric, manifest, manifestSha256),
    /does not match the frozen manifest/,
  );
});

test("run configurations share every setting except Ariadne availability", () => {
  assert.deepEqual(runConfigs.conditions.control.additionalTools, []);
  assert.deepEqual(runConfigs.conditions.ariadne.additionalTools, [
    "ari.repo_overview",
    "ari.find_symbol",
    "ari.describe_symbol",
    "ari.dependencies",
    "ari.dependents",
  ]);
  assert.equal(Object.hasOwn(runConfigs.conditions.control, "model"), false);
  assert.equal(Object.hasOwn(runConfigs.conditions.ariadne, "model"), false);
  assert.equal(runConfigs.common.modelRef, "./task.manifest.json#/agent");
  assert.equal(
    manifest.agent.instructions.includes(
      "When Ariadne tools are available, call ari.repo_overview before any source or search navigation and use Ariadne for initial repository navigation. When Ariadne tools are unavailable, use the standard repository navigation tools.",
    ),
    true,
  );
});

test("normalizes stamped control output without inventing context token counts", () => {
  const trace = normalizeCapture(readFixture("sample-codex-control.jsonl"), {
    runId: "control-fixture",
    condition: "control",
    manifest,
    runConfigs,
    manifestSha256,
  });

  assert.equal(trace.runner.version, "0.146.1");
  assert.equal(trace.model.id, "gpt-5.6-sol");
  assert.deepEqual(trace.usage, {
    inputTokens: 1200,
    cachedInputTokens: 200,
    outputTokens: 180,
    reasoningOutputTokens: 80,
  });
  assert.deepEqual(
    trace.events.filter(({ type }) => type === "tool_call").map(({ category }) => category),
    ["search", "source"],
  );
  assert.deepEqual(trace.events[3].context, [{
    kind: "source",
    path: "src/game.ts",
    content: "line one\nline two\n",
  }]);
  assert.equal(trace.events.at(-1).diagnosis.rootCause, "Fixture root cause");
});

test("stamps each raw Codex event without changing its payload", async () => {
  const chunks = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const original = { type: "thread.started", thread_id: "fixture" };

  await stampCodexJsonl(Readable.from(`${JSON.stringify(original)}\n`), output);

  const [header, record] = chunks.join("").trim().split("\n").map(JSON.parse);
  assert.equal(header.type, "capture.started");
  assert.equal(header.captureVersion, 1);
  assert.deepEqual(record.event, original);
  assert.equal(Number.isInteger(record.elapsedMs), true);
});

test("normalizes allowed Ariadne calls and rejects them in control runs", () => {
  const capture = readFixture("sample-codex-ariadne.jsonl");
  const trace = normalizeCapture(capture, {
    runId: "ariadne-fixture",
    condition: "ariadne",
    manifest,
    runConfigs,
    manifestSha256,
  });

  assert.equal(trace.events[0].tool, "ari.find_symbol");
  assert.equal(trace.events[1].context[0].kind, "ariadne_result");
  assert.throws(
    () => normalizeCapture(capture, {
      runId: "control-invalid",
      condition: "control",
      manifest,
      runConfigs,
      manifestSha256,
    }),
    /MCP tool is not allowed for control/,
  );
});

test("requires Ariadne before source or search navigation in treatment runs", () => {
  assert.throws(
    () => normalizeCapture(readFixture("sample-codex-control.jsonl"), {
      runId: "ariadne-without-ariadne",
      condition: "ariadne",
      manifest,
      runConfigs,
      manifestSha256,
    }),
    /must use Ariadne before source or search navigation/,
  );
});

test("rejects actions outside the diagnosis-only navigation protocol", () => {
  const capture = readFixture("sample-codex-control.jsonl").replace(
    /rg scene src/g,
    "npm test",
  );

  assert.throws(
    () => normalizeCapture(capture, {
      runId: "control-invalid",
      condition: "control",
      manifest,
      runConfigs,
      manifestSha256,
    }),
    /unsupported command in controlled run/,
  );
});

test("unwraps real Windows command events and ignores controls inside quotes", () => {
  const capture = mapCapture(readFixture("sample-codex-control.jsonl"), (record) => {
    const item = record.event?.item;
    if (item?.type === "command_execution") {
      const script = item.command === "rg scene src" ? 'rg "scene|frame" src' : item.command;
      const wrapperQuote = item.command === "rg scene src" ? "'" : '"';
      item.command = `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command ${wrapperQuote}${script}"`;
    }
    return record;
  });

  const trace = normalizeCapture(capture, {
    runId: "windows-wrapper",
    condition: "control",
    manifest,
    runConfigs,
    manifestSha256,
  });

  assert.deepEqual(
    trace.events.filter(({ type }) => type === "tool_call").map(({ category }) => category),
    ["search", "source"],
  );
});

test("counts non-code file reads as context rather than source", () => {
  const capture = readFixture("sample-codex-control.jsonl").replaceAll(
    "src/game.ts",
    "docs/README.md",
  );
  const trace = normalizeCapture(capture, {
    runId: "documentation-read",
    condition: "control",
    manifest,
    runConfigs,
    manifestSha256,
  });

  assert.equal(trace.events[2].category, "other");
  assert.equal(trace.events[3].context[0].kind, "other");
});
