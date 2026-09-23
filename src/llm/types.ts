export interface Finding {
  file_path: string;
  line_number: number;
  category: "bug-risk" | "security" | "style";
  severity: "low" | "medium" | "high";
  explanation: string;
}

export interface LLMResult {
  findings: Finding[];
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}
