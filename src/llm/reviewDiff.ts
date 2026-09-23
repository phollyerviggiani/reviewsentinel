import type { Finding, LLMResult } from "./types.js";

// Deliberately conservative system prompt: a code review bot that
// over-flags trains developers to ignore it, which is worse than one
// that under-flags. "Fail closed" starts here, at the prompt level.
const SYSTEM_PROMPT = `You are a careful senior code reviewer looking at a pull request diff.

Only report REAL issues that are clearly visible in the diff itself. Never invent
a file path or line number that does not appear in the diff. Use the line number
as it appears in the NEW version of the file (the "+" side of the hunk).

Focus on: genuine bugs, security issues, and clear style problems. Do not report
speculative or stylistic nitpicks you are not confident about.

If you find nothing worth flagging, call the tool with an empty findings array.
Being conservative is correct: a missed issue is better than a false alarm.`;

// Forcing tool_choice guarantees structured JSON output instead of
// free-form text we'd have to parse with regex - this is the whole
// point of using function calling here rather than a plain chat prompt.
const FINDINGS_TOOL = {
  type: "function",
  function: {
    name: "report_findings",
    description: "Report code review findings identified in the diff.",
    parameters: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file_path: {
                type: "string",
                description: "Exact file path as it appears in the diff.",
              },
              line_number: {
                type: "integer",
                description: "Line number in the NEW version of the file, per the diff hunk.",
              },
              category: {
                type: "string",
                enum: ["bug-risk", "security", "style"],
              },
              severity: {
                type: "string",
                enum: ["low", "medium", "high"],
              },
              explanation: {
                type: "string",
                description: "One or two sentences explaining the issue.",
              },
            },
            required: ["file_path", "line_number", "category", "severity", "explanation"],
          },
        },
      },
      required: ["findings"],
    },
  },
} as const;

export async function reviewDiff(diff: string): Promise<LLMResult> {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  const start = Date.now();

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Review this diff:\n\n${diff}` },
      ],
      tools: [FINDINGS_TOOL],
      tool_choice: { type: "function", function: { name: "report_findings" } },
      temperature: 0, // deterministic-as-possible for a review tool, not a creative one
    }),
  });

  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq API error ${res.status}: ${body}`);
  }

  const data: any = await res.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

  // If the model didn't call the tool at all, treat it as "no findings"
  // rather than throwing - fail closed, don't crash the pipeline.
  if (!toolCall) {
    return {
      findings: [],
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      latencyMs,
    };
  }

  let findings: Finding[] = [];
  try {
    const args = JSON.parse(toolCall.function.arguments);
    findings = Array.isArray(args.findings) ? args.findings : [];
  } catch {
    // Malformed JSON from the model - again, fail closed rather than crash.
    findings = [];
  }

  return {
    findings,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    latencyMs,
  };
}
