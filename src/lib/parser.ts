import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkFrontmatter from "remark-frontmatter";
import { selectAll } from "unist-util-select";
import { toString } from "mdast-util-to-string";
import type { Root, Heading, Node } from "mdast";
import type { HeadingEntry } from "../types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _processor: any = null;

function getProcessor() {
  if (!_processor) {
    _processor = unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ["yaml", "toml"])
      .use(remarkStringify);
  }
  return _processor;
}

export function parseMarkdown(content: string): Root {
  return getProcessor().parse(content) as Root;
}

export function stringifyMarkdown(tree: Root): string {
  return String(getProcessor().stringify(tree));
}

export function toAnchorSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function headingText(node: Heading): string {
  return toString(node);
}

function getNodeLine(node: Node): number {
  return node.position?.start.line ?? 0;
}

function getNodeEndLine(node: Node): number {
  return node.position?.end.line ?? 0;
}

export function getLastLine(tree: Root): number {
  if (tree.children.length === 0) return 0;
  const last = tree.children[tree.children.length - 1];
  return last.position?.end.line ?? 0;
}

export function extractHeadings(tree: Root): HeadingEntry[] {
  const headingNodes = selectAll("heading", tree) as Heading[];
  return headingNodes.map((h) => ({
    level: h.depth,
    text: headingText(h),
    anchor: toAnchorSlug(headingText(h)),
    line: getNodeLine(h),
    end_line: 0, // filled in by sections.ts
  }));
}

export function resolveHeading(
  tree: Root,
  target: string,
): {
  heading: Heading | null;
  ambiguous: boolean;
  alternatives?: HeadingEntry[];
} | null {
  const headingNodes = selectAll("heading", tree) as Heading[];
  const targetLower = target.toLowerCase();
  const targetAnchor = toAnchorSlug(target);

  // Try exact text match first (case-insensitive), then anchor match
  const byText = headingNodes.filter(
    (h) => headingText(h).toLowerCase() === targetLower,
  );
  const byAnchor = headingNodes.filter(
    (h) => toAnchorSlug(headingText(h)) === targetAnchor,
  );

  const matches =
    byText.length > 0
      ? byText
      : byAnchor.length > 0
        ? byAnchor
        : [];

  if (matches.length === 0) return null;

  const heading = matches[0];
  const alternatives: HeadingEntry[] = matches.slice(1).map((h) => ({
    level: h.depth,
    text: headingText(h),
    anchor: toAnchorSlug(headingText(h)),
    line: getNodeLine(h),
    end_line: 0,
  }));

  return {
    heading,
    ambiguous: matches.length > 1,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
  };
}
