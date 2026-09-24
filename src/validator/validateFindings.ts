import type { Finding } from "../llm/types.js";
import { parseDiffLineRanges } from "./parseDiff.js";

export interface ValidationResult {
  finding: Finding;
  valid: boolean;
  reason?: string;
}

// This is the safety net for the whole project: anything the LLM flags
// gets independently checked against the real diff before it's allowed
// anywhere near a comment on someone's actual pull request. A finding
// only passes if BOTH the file and the exact line number genuinely
// exist in the diff's new version of the code.
export function validateFindings(diff: string, findings: Finding[]): ValidationResult[] {
  const ranges = parseDiffLineRanges(diff);

  return findings.map((finding) => {
    const fileLines = ranges[finding.file_path];

    if (!fileLines) {
      return {
        finding,
        valid: false,
        reason: `file not present in diff: ${finding.file_path}`,
      };
    }

    if (!fileLines.has(finding.line_number)) {
      return {
        finding,
        valid: false,
        reason: `line ${finding.line_number} not present in diff for ${finding.file_path}`,
      };
    }

    return { finding, valid: true };
  });
}
