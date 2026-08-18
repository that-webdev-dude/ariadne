import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

export function analyzeResults(document, rubric, manifest, manifestSha256) {
  if (!Array.isArray(document?.runs) || document.runs.length === 0) {
    throw new Error("results.runs must be a non-empty array");
  }
  if (rubric.benchmarkId !== manifest.benchmarkId) {
    throw new Error("rubric does not match the frozen manifest");
  }

  const rows = document.runs.map((run) =>
    summarizeRun(run, rubric, manifest, manifestSha256),
  );
  const control = aggregate(rows, "control");
  const ariadne = aggregate(rows, "ariadne");

  if (!control || !ariadne) {
    throw new Error("results must contain control and ariadne runs");
  }

  return {
    rows,
    aggregates: { control, ariadne },
    comparison: {
      sourceLineReductionPercent: reduction(
        control.meanSourceLines,
        ariadne.meanSourceLines,
      ),
      sourceTokenReductionPercent: reduction(
        control.meanSourceTokens,
        ariadne.meanSourceTokens,
      ),
      contextTokenReductionPercent: reduction(
        control.meanContextTokens,
        ariadne.meanContextTokens,
      ),
      toolCallReductionPercent: reduction(
        control.meanToolCalls,
        ariadne.meanToolCalls,
      ),
      resolutionTimeReductionPercent: reduction(
        control.meanResolutionMs,
        ariadne.meanResolutionMs,
      ),
      diagnosisQualityPreserved:
        ariadne.accuracyPasses === ariadne.runs &&
        ariadne.meanDiagnosisScore >= control.meanDiagnosisScore,
    },
  };
}

export function summarizeRun(run, rubric, manifest, manifestSha256) {
  const trace = run?.trace;
  if (!trace || !Array.isArray(trace.events)) {
    throw new Error("run.trace.events must be an array");
  }
  if (trace.benchmarkId !== rubric.benchmarkId) {
    throw new Error(`benchmark mismatch for ${trace.runId ?? "unknown run"}`);
  }
  if (trace.condition !== "control" && trace.condition !== "ariadne") {
    throw new Error(`invalid condition for ${trace.runId ?? "unknown run"}`);
  }
  if (trace.runConfigId !== trace.condition) {
    throw new Error(`${trace.runId} has the wrong run configuration`);
  }
  validateFrozenInputs(trace, manifest, manifestSha256);

  validateEventOrder(trace);
  const calls = trace.events.filter(({ type }) => type === "tool_call");
  const results = trace.events.filter(({ type }) => type === "tool_result");
  const finals = trace.events.filter(({ type }) => type === "final");
  if (finals.length !== 1) {
    throw new Error(`${trace.runId} must contain exactly one final event`);
  }

  validateCallPairs(trace.runId, calls, results);
  const context = results.flatMap((result) => result.context ?? []);
  const source = context.filter(({ kind }) => kind === "source");
  const score = scoreAssessment(rubric, run.assessment);

  return {
    runId: trace.runId,
    condition: trace.condition,
    diagnosisScore: score.total,
    diagnosisMax: score.maximum,
    accuracyPass: score.pass,
    toolCalls: calls.length,
    searchCalls: calls.filter(({ category }) => category === "search").length,
    sourceReadCalls: calls.filter(({ category }) => category === "source").length,
    ariadneCalls: calls.filter(({ category }) => category === "ariadne").length,
    sourceFiles: new Set(source.map(({ path }) => path)).size,
    sourceLines: sum(source.map(({ content }) => countLines(content))),
    sourceCharacters: sum(source.map(({ content }) => content.length)),
    sourceTokens: completeTokenTotal(source),
    contextCharacters: sum(context.map(({ content }) => content.length)),
    contextTokens: completeTokenTotal(context),
    modelInputTokens: trace.usage.inputTokens,
    modelOutputTokens: trace.usage.outputTokens,
    resolutionMs: finals[0].elapsedMs,
  };
}

export function scoreAssessment(rubric, assessment) {
  const awarded = assessment?.points;
  if (!awarded || typeof awarded !== "object" || Array.isArray(awarded)) {
    throw new Error("assessment.points must be an object");
  }

  const criteria = rubric.criteria ?? [];
  const expectedIds = new Set(criteria.map(({ id }) => id));
  const actualIds = Object.keys(awarded);
  if (
    actualIds.length !== expectedIds.size ||
    actualIds.some((id) => !expectedIds.has(id))
  ) {
    throw new Error("assessment criteria must exactly match the rubric");
  }

  let total = 0;
  let maximum = 0;
  for (const criterion of criteria) {
    const points = awarded[criterion.id];
    if (
      !Number.isInteger(points) ||
      points < 0 ||
      points > criterion.maxPoints
    ) {
      throw new Error(`invalid points for ${criterion.id}`);
    }
    total += points;
    maximum += criterion.maxPoints;
  }

  const required = rubric.accuracyGate?.requiredMinimums ?? {};
  const pass =
    total >= rubric.accuracyGate.minimumTotal &&
    Object.entries(required).every(([id, minimum]) => awarded[id] >= minimum);

  return { total, maximum, pass };
}

export function hashManifest(content) {
  return createHash("sha256")
    .update(content.replace(/\r\n/g, "\n"))
    .digest("hex");
}

export function renderMarkdown(analysis) {
  const lines = [
    "| Run | Condition | Diagnosis | Tool calls | Searches | Source reads | Ariadne calls | Source files | Source lines | Source tokens | Context tokens | Model input tokens | Model output tokens | Resolution ms |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const row of analysis.rows) {
    lines.push(
      `| ${row.runId} | ${row.condition} | ${row.diagnosisScore}/${row.diagnosisMax} ${row.accuracyPass ? "pass" : "fail"} | ${row.toolCalls} | ${row.searchCalls} | ${row.sourceReadCalls} | ${row.ariadneCalls} | ${row.sourceFiles} | ${row.sourceLines} | ${display(row.sourceTokens)} | ${display(row.contextTokens)} | ${row.modelInputTokens} | ${row.modelOutputTokens} | ${row.resolutionMs} |`,
    );
  }

  lines.push(
    "",
    "| Condition | Runs | Accuracy passes | Mean score | Mean source lines | Mean source tokens | Mean context tokens | Mean tool calls | Mean model input tokens | Mean model output tokens | Mean resolution ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const aggregate of [
    analysis.aggregates.control,
    analysis.aggregates.ariadne,
  ]) {
    lines.push(
      `| ${aggregate.condition} | ${aggregate.runs} | ${aggregate.accuracyPasses} | ${fixed(aggregate.meanDiagnosisScore)} | ${fixed(aggregate.meanSourceLines)} | ${displayFixed(aggregate.meanSourceTokens)} | ${displayFixed(aggregate.meanContextTokens)} | ${fixed(aggregate.meanToolCalls)} | ${fixed(aggregate.meanModelInputTokens)} | ${fixed(aggregate.meanModelOutputTokens)} | ${fixed(aggregate.meanResolutionMs)} |`,
    );
  }

  lines.push(
    "",
    `Source-line reduction: ${percent(analysis.comparison.sourceLineReductionPercent)}`,
    `Source-token reduction: ${percent(analysis.comparison.sourceTokenReductionPercent)}`,
    `Context-token reduction: ${percent(analysis.comparison.contextTokenReductionPercent)}`,
    `Tool-call reduction: ${percent(analysis.comparison.toolCallReductionPercent)}`,
    `Time-to-resolution reduction: ${percent(analysis.comparison.resolutionTimeReductionPercent)}`,
    `Diagnosis quality preserved: ${analysis.comparison.diagnosisQualityPreserved ? "yes" : "no"}`,
  );

  return `${lines.join("\n")}\n`;
}

function validateEventOrder(trace) {
  let previousSequence = 0;
  let previousElapsedMs = -1;
  for (const event of trace.events) {
    if (
      !Number.isInteger(event.sequence) ||
      event.sequence <= previousSequence ||
      !Number.isInteger(event.elapsedMs) ||
      event.elapsedMs < previousElapsedMs
    ) {
      throw new Error(`${trace.runId} events must be strictly sequenced and monotonic`);
    }
    previousSequence = event.sequence;
    previousElapsedMs = event.elapsedMs;
  }
}

function validateFrozenInputs(trace, manifest, manifestSha256) {
  const expectedModel = {
    provider: manifest.agent.provider,
    id: manifest.agent.model,
    settings: manifest.agent.settings,
  };
  const expectedAriadneCommit =
    trace.condition === "ariadne" ? manifest.ariadne.functionalityCommit : null;

  if (
    trace.manifestSha256 !== manifestSha256 ||
    trace.targetCommit !== manifest.target.commit ||
    trace.ariadneCommit !== expectedAriadneCommit ||
    !isDeepStrictEqual(trace.runner, manifest.runner) ||
    !isDeepStrictEqual(trace.model, expectedModel)
  ) {
    throw new Error(`${trace.runId} does not match the frozen manifest`);
  }
}

function validateCallPairs(runId, calls, results) {
  const callIds = new Set();
  for (const call of calls) {
    if (!call.callId || callIds.has(call.callId)) {
      throw new Error(`${runId} has a missing or duplicate callId`);
    }
    callIds.add(call.callId);
  }

  const resultIds = new Set();
  for (const result of results) {
    if (!callIds.has(result.callId) || resultIds.has(result.callId)) {
      throw new Error(`${runId} has an unmatched or duplicate tool result`);
    }
    resultIds.add(result.callId);
  }

  if (resultIds.size !== callIds.size) {
    throw new Error(`${runId} has a tool call without a result`);
  }
}

function aggregate(rows, condition) {
  const selected = rows.filter((row) => row.condition === condition);
  if (selected.length === 0) return null;

  return {
    condition,
    runs: selected.length,
    accuracyPasses: selected.filter(({ accuracyPass }) => accuracyPass).length,
    meanDiagnosisScore: mean(selected.map(({ diagnosisScore }) => diagnosisScore)),
    meanSourceLines: mean(selected.map(({ sourceLines }) => sourceLines)),
    meanSourceTokens: nullableMean(selected.map(({ sourceTokens }) => sourceTokens)),
    meanContextTokens: nullableMean(selected.map(({ contextTokens }) => contextTokens)),
    meanToolCalls: mean(selected.map(({ toolCalls }) => toolCalls)),
    meanModelInputTokens: mean(selected.map(({ modelInputTokens }) => modelInputTokens)),
    meanModelOutputTokens: mean(selected.map(({ modelOutputTokens }) => modelOutputTokens)),
    meanResolutionMs: mean(selected.map(({ resolutionMs }) => resolutionMs)),
  };
}

function completeTokenTotal(items) {
  if (items.some(({ tokenCount }) => !Number.isInteger(tokenCount))) return null;
  return sum(items.map(({ tokenCount }) => tokenCount));
}

function countLines(content) {
  if (content.length === 0) return 0;
  const breaks = content.match(/\r\n|\r|\n/g)?.length ?? 0;
  return breaks + (/\r\n$|\r$|\n$/.test(content) ? 0 : 1);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values) {
  return sum(values) / values.length;
}

function nullableMean(values) {
  return values.some((value) => value === null) ? null : mean(values);
}

function reduction(control, treatment) {
  if (control === null || treatment === null || control === 0) return null;
  return ((control - treatment) / control) * 100;
}

function display(value) {
  return value === null ? "n/a" : String(value);
}

function fixed(value) {
  return value.toFixed(1);
}

function displayFixed(value) {
  return value === null ? "n/a" : fixed(value);
}

function percent(value) {
  return value === null ? "n/a" : `${fixed(value)}%`;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npm run benchmark -- <results.json>");
    process.exitCode = 1;
  } else {
    const document = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
    const rubricPath = resolve(import.meta.dirname, "diagnosis-rubric.json");
    const rubric = JSON.parse(readFileSync(rubricPath, "utf8"));
    const manifestPath = resolve(import.meta.dirname, "task.manifest.json");
    const manifestContent = readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);
    process.stdout.write(
      renderMarkdown(
        analyzeResults(document, rubric, manifest, hashManifest(manifestContent)),
      ),
    );
  }
}
