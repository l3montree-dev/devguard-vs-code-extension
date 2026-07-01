import * as vscode from "vscode";
import { DepType } from "../api/types";
import { DependencyEntry, SectionInfo, entryAt} from "../packageJson/parse";

export function isGoMod(document: vscode.TextDocument): boolean {
  return (
    document.uri.scheme === "file" &&
    /(^|[\\/])go\.mod$/.test(document.uri.fsPath)
  );
}


interface ParsedLine {
  /** Module path, e.g. "github.com/gin-gonic/gin" */
  name: string;
  /** Version string, e.g. "v1.9.1" or "v0.0.0-20231015123456-abcdef012345" */
  version: string;
  indirect: boolean;
  lineIndex: number;
  nameStart: number;
  /** Character offset (0-based) where the version string starts on the line */
  versionStart: number;
}

interface ParsedSection {
  depType: DepType;
  /** Zero-based line index of the `require` keyword */
  lineIndex: number;
}

function parseGoMod(text: string): {
  lines: ParsedLine[];
  sections: ParsedSection[];
} {
  const rawLines = text.split("\n");
  const parsedLines: ParsedLine[] = [];
  const sections: ParsedSection[] = [];

  // Group 1: leading whitespace  Group 2: module path  Group 3: version
  const depRe = /^(\s*)([\w.\-]+(?:\/[\w.\-]+)*(?:\/v\d+)?)\s+(v[\w.\-+]+)/;
  const indirectRe = /\/\/\s*indirect/;

  let inRequireBlock = false;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];

    // Strip inline comments for directive detection, but keep raw for offset math
    const noComment = raw.replace(/\/\/.*$/, "");


    if (/^\s*require\s*\(/.test(noComment)) {
      inRequireBlock = true;
      // Section opener line; individual entries determine their own depType,
      // so we emit one section per block using a placeholder — callers that
      // only need the line number use this; callers that need depType use
      // the per-entry values from parseDependencies().
      sections.push({ depType: "goDirectDependency", lineIndex: i });
      continue;
    }

    if (inRequireBlock && /^\s*\)/.test(noComment)) {
      inRequireBlock = false;
      continue;
    }

    if (!inRequireBlock && /^\s*require\s+/.test(noComment)) {
      const keywordOffset = raw.indexOf("require") + "require".length;
      const spaceAfter = raw.slice(keywordOffset).match(/^\s+/);
      const contentStart =
        keywordOffset + (spaceAfter ? spaceAfter[0].length : 0);
      const contentStr = raw.slice(contentStart);
      const m = contentStr.match(
        /^([\w.\-]+(?:\/[\w.\-]+)*(?:\/v\d+)?)\s+(v[\w.\-+]+)/,
      );
      if (m) {
        const spaceLen =
          contentStr.slice(m[1].length).match(/^\s+/)?.[0].length ?? 0;
        parsedLines.push({
          name: m[1],
          version: m[2],
          indirect: indirectRe.test(raw),
          lineIndex: i,
          nameStart: contentStart,
          versionStart: contentStart + m[1].length + spaceLen,
        });
      }
      continue;
    }

    if (inRequireBlock) {
      const m = raw.match(depRe);
      if (m) {
        const nameStart = m[1].length;
        const spaceLen =
          raw.slice(nameStart + m[2].length).match(/^\s+/)?.[0].length ?? 0;
        parsedLines.push({
          name: m[2],
          version: m[3],
          indirect: indirectRe.test(raw),
          lineIndex: i,
          nameStart,
          versionStart: nameStart + m[2].length + spaceLen,
        });
      }
    }
  }

  return { lines: parsedLines, sections };
}

export function parseDependencies(
  document: vscode.TextDocument,
): DependencyEntry[] {
  const { lines } = parseGoMod(document.getText());
  return lines.map((p) => {
    const depType: DepType = p.indirect
      ? "goIndirectDependency"
      : "goDirectDependency";

    const keyRange = new vscode.Range(
      new vscode.Position(p.lineIndex, p.nameStart),
      new vscode.Position(p.lineIndex, p.nameStart + p.name.length),
    );
    const valueRange = new vscode.Range(
      new vscode.Position(p.lineIndex, p.versionStart),
      new vscode.Position(p.lineIndex, p.versionStart + p.version.length),
    );

    return {
      name: p.name,
      rangeSpec: p.version,
      depType,
      keyRange,
      valueRange,
    };
  });
}

export function parseSections(document: vscode.TextDocument): SectionInfo[] {
  const { sections } = parseGoMod(document.getText());
  return sections.map((s) => ({ depType: s.depType, line: s.lineIndex }));
}
