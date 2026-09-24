// Maps each changed file to the set of line numbers (in the NEW version
// of the file) that actually appear in the diff. This is the ground
// truth the validator checks every AI finding against.
export type DiffLineRanges = Record<string, Set<number>>;

export function parseDiffLineRanges(diff: string): DiffLineRanges {
  const ranges: DiffLineRanges = {};
  const lines = diff.split("\n");

  let currentFile: string | null = null;
  let newLineNum = 0;

  for (const line of lines) {
    // New file section: "diff --git a/path b/path"
    const fileMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[2];
      ranges[currentFile] = ranges[currentFile] ?? new Set();
      continue;
    }

    // Hunk header: "@@ -oldStart,oldLines +newStart,newLines @@"
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLineNum = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith("+++") || line.startsWith("---")) {
      continue; // file header lines, not content
    }

    if (line.startsWith("+")) {
      // an added line - exists in the new file at newLineNum
      ranges[currentFile].add(newLineNum);
      newLineNum++;
    } else if (line.startsWith(" ")) {
      // unchanged context line - also exists in the new file
      ranges[currentFile].add(newLineNum);
      newLineNum++;
    }
    // lines starting with "-" are deletions: they existed in the OLD
    // file only, so they do not exist in the new file and must NOT
    // advance newLineNum or be added to the valid set.
  }

  return ranges;
}
