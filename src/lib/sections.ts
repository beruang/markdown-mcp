import { selectAll } from "unist-util-select";
import { toString } from "mdast-util-to-string";
import type { Root, Heading } from "mdast";
import type { HeadingEntry, SectionBounds } from "../types.js";
import { extractHeadings, getLastLine, toAnchorSlug } from "./parser.js";

export function getSectionBounds(tree: Root, heading: Heading): SectionBounds {
  const headingNodes = selectAll("heading", tree) as Heading[];
  const targetLine = heading.position?.start.line ?? 0;

  const idx = headingNodes.findIndex(
    (h) => (h.position?.start.line ?? 0) === targetLine,
  );

  if (idx === -1) {
    return { start: targetLine, end: getLastLine(tree) };
  }

  const nextSibling = headingNodes
    .slice(idx + 1)
    .find((h) => h.depth <= heading.depth);

  const start = targetLine;
  const end = nextSibling
    ? nextSibling.position!.start.line - 1
    : getLastLine(tree);

  return { start, end };
}

export function computeAllSectionBounds(tree: Root): HeadingEntry[] {
  const entries = extractHeadings(tree);
  const headingNodes = selectAll("heading", tree) as Heading[];

  return entries.map((entry, i) => {
    const heading = headingNodes[i];
    const bounds = getSectionBounds(tree, heading);
    return { ...entry, end_line: bounds.end };
  });
}

export function getSectionContent(
  lines: string[],
  bounds: SectionBounds,
  includeHeading: boolean,
): string {
  // bounds are 1-indexed, lines array is 0-indexed
  const from = includeHeading ? bounds.start - 1 : bounds.start;
  const to = bounds.end;
  return lines.slice(from, to).join("\n");
}

export function findSectionContainingLine(
  tree: Root,
  line: number,
): HeadingEntry | null {
  const all = computeAllSectionBounds(tree);
  // Return the deepest (last matching, narrowest range) section containing this line
  let best: HeadingEntry | null = null;
  for (const entry of all) {
    if (entry.line <= line && line <= entry.end_line) {
      if (!best || entry.level > best.level) {
        best = entry;
      }
    }
  }
  return best;
}

export function getChildHeadings(
  tree: Root,
  parentHeading: Heading,
): HeadingEntry[] {
  const bounds = getSectionBounds(tree, parentHeading);
  const headingNodes = selectAll("heading", tree) as Heading[];
  const targetDepth = parentHeading.depth;

  return headingNodes
    .filter((h) => {
      const line = h.position?.start.line ?? 0;
      return (
        line > bounds.start &&
        line <= bounds.end &&
        h.depth === targetDepth + 1
      );
    })
    .map((h) => {
      const text = toString(h);
      return {
        level: h.depth,
        text,
        anchor: toAnchorSlug(text),
        line: h.position?.start.line ?? 0,
        end_line: 0,
      };
    });
}
