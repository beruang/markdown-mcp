import yaml from "js-yaml";
import { parse as parseToml } from "toml";
import type { DiffResult, FrontmatterResult } from "../types.js";

const YAML_DELIM = "---";
const TOML_DELIM = "+++";

export function extractFrontmatter(content: string): FrontmatterResult {
  const lines = content.split("\n");

  if (lines.length === 0) {
    return { format: "none", raw: "", parsed: {}, startLine: 0, endLine: 0 };
  }

  const firstLine = lines[0].trimEnd();
  let format: "yaml" | "toml" | "none" = "none";
  let delim = "";

  if (firstLine === YAML_DELIM) {
    format = "yaml";
    delim = YAML_DELIM;
  } else if (firstLine === TOML_DELIM) {
    format = "toml";
    delim = TOML_DELIM;
  }

  if (format === "none") {
    return { format: "none", raw: "", parsed: {}, startLine: 0, endLine: 0 };
  }

  // Find closing delimiter
  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === delim) {
      endLine = i;
      break;
    }
  }

  if (endLine === -1) {
    // No closing delimiter — treat entire file as frontmatter? Return none.
    return { format: "none", raw: "", parsed: {}, startLine: 0, endLine: 0 };
  }

  const raw = lines.slice(1, endLine).join("\n");
  let parsed: Record<string, unknown> = {};

  try {
    if (format === "yaml") {
      const result = yaml.load(raw);
      parsed =
        result !== null && typeof result === "object"
          ? (result as Record<string, unknown>)
          : {};
    } else {
      parsed = parseToml(raw) as Record<string, unknown>;
    }
  } catch {
    // Parse error — return raw content but empty parsed
  }

  return {
    format,
    raw,
    parsed,
    startLine: 1,
    endLine: endLine + 1, // 1-indexed
  };
}

export function serializeFrontmatter(
  data: Record<string, unknown>,
  format: "yaml" | "toml",
): string {
  if (format === "yaml") {
    return yaml.dump(data, { lineWidth: -1, noRefs: true }).trimEnd();
  }
  // TOML doesn't have a standard serializer — use a simple key-value format
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`${key} = ${JSON.stringify(value)}`);
  }
  return lines.join("\n");
}

export function setFrontmatterKeys(
  content: string,
  updates: Record<string, unknown>,
  removeKeys: string[],
): { newContent: string; diff: DiffResult } {
  const fm = extractFrontmatter(content);
  const lines = content.split("\n");

  if (fm.format === "none") {
    // Create new YAML frontmatter
    const merged = { ...updates };
    for (const k of removeKeys) delete merged[k];

    const newFm = YAML_DELIM + "\n" + serializeFrontmatter(merged, "yaml") + "\n" + YAML_DELIM;
    const newContent = newFm + "\n" + content.trimStart();
    return {
      newContent,
      diff: {
        start_line: 1,
        end_line: 0,
        before: "",
        after: newFm,
      },
    };
  }

  // Merge updates into existing, remove keys
  const merged = { ...fm.parsed, ...updates };
  for (const k of removeKeys) delete merged[k];

  const newFmBody = serializeFrontmatter(merged, fm.format);
  const before = lines.slice(fm.startLine - 1, fm.endLine).join("\n");
  const after = fm.format === "yaml" ? YAML_DELIM + "\n" + newFmBody + "\n" + YAML_DELIM
    : TOML_DELIM + "\n" + newFmBody + "\n" + TOML_DELIM;

  const newLines = [...lines];
  newLines.splice(fm.startLine - 1, fm.endLine - fm.startLine + 1, after);
  // Don't split 'after' — it's already a single block
  const head = lines.slice(0, fm.startLine - 1);
  const tail = lines.slice(fm.endLine);
  const afterBlock = after.split("\n");
  const newContent = [...head, ...afterBlock, ...tail].join("\n");

  return {
    newContent,
    diff: {
      start_line: fm.startLine,
      end_line: fm.endLine,
      before,
      after,
    },
  };
}

export function hasFrontmatter(content: string): boolean {
  const firstLine = content.split("\n")[0]?.trimEnd() ?? "";
  return firstLine === YAML_DELIM || firstLine === TOML_DELIM;
}
