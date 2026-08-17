import type { LoadedProject } from "../project/loader.js";
import type { ExtractedIndex } from "../records.js";
import { extractCalls } from "./calls.js";
import { extractImports } from "./imports.js";
import { extractProjectSymbols } from "./symbols.js";

export function extractProject(project: LoadedProject): ExtractedIndex {
  const symbols = extractProjectSymbols(project);

  return {
    files: symbols.files,
    imports: extractImports(project, symbols.files),
    calls: extractCalls(project, symbols),
  };
}
