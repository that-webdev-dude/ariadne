import assert from "node:assert/strict";
import { relative, resolve, sep } from "node:path";
import test from "node:test";
import { extractFilesAndSymbols } from "../src/extractor/symbols.js";
import { loadProject } from "../src/project/loader.js";

const fixturePath = resolve(
  import.meta.dirname,
  "../../tests/fixtures/basic-project",
);

test("project loader and extractor return only supported named symbols", () => {
  const project = loadProject(fixturePath);
  const files = extractFilesAndSymbols(project);

  assert.equal(project.configPath, resolve(fixturePath, "tsconfig.json"));
  assert.deepEqual(
    project.sourceFiles.map((sourceFile) =>
      relative(fixturePath, sourceFile.fileName).split(sep).join("/"),
    ),
    ["src/main.ts", "src/nested.ts"],
  );
  assert.deepEqual(
    files.map((file) => file.path),
    ["src/main.ts", "src/nested.ts"],
  );

  const symbols = files.flatMap((file) => file.symbols);
  assert.deepEqual(
    symbols.map(({ name, kind }) => [name, kind]),
    [
      ["greet", "function"],
      ["localHelper", "function"],
      ["Greeter", "class"],
      ["greet", "method"],
      ["create", "method"],
      ["Formatter", "interface"],
      ["format", "method"],
      ["FormatterFactory", "type_alias"],
      ["uppercase", "callable_variable"],
      ["double", "callable_variable"],
      ["Payload", "type_alias"],
    ],
  );

  const functionSymbol = symbols.find(
    (symbol) => symbol.name === "greet" && symbol.kind === "function",
  );
  assert.equal(functionSymbol?.startLine, 1);
  assert.equal(functionSymbol?.startColumn, 1);
  assert.match(functionSymbol?.qualifiedName ?? "", /\.greet$/);
  assert.equal(functionSymbol?.signature, "(name: string): string");

  const methodSymbol = symbols.find(
    (symbol) => symbol.name === "greet" && symbol.kind === "method",
  );
  assert.match(methodSymbol?.qualifiedName ?? "", /\.Greeter\.greet$/);
  assert.equal(methodSymbol?.signature, "(name: string): string");

  for (const symbol of symbols) {
    assert.ok(symbol.endLine >= symbol.startLine);
    assert.ok(symbol.startColumn >= 1);
    assert.ok(symbol.endColumn >= 1);
  }

  assert.equal(symbols.some((symbol) => symbol.name === "answer"), false);
  assert.equal(symbols.some((symbol) => symbol.name === "mapped"), false);
  assert.equal(symbols.some((symbol) => symbol.name === "default"), false);
});
