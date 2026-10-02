import type { Finding, LLMResult } from "./types.js";

const SYSTEM_PROMPT = `You are a careful senior code reviewer looking at a pull request diff.

Only report REAL issues that are clearly visible in the diff itself. Never invent
a file path or line number that does not appear in the diff. Use the line number
as it appears in the NEW version of the file (the "+" side of the hunk).

Focus on: genuine bugs, security issues, and clear style problems. Do not report
speculative or stylistic nitpicks you are not confident about.

If you find nothing worth flagging, call the tool with an empty findings array.
Being conservative is correct: a missed issue is better than a false alarm.`;

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
              file_path: { type: "string", description: "Exact file path as it appears in the diff." },
              line_number: {
                type: "integer",
                description: "Line number in the NEW version of the file, per the diff hunk.",
              },
              category: { type: "string", enum: ["bug-risk", "security", "style"] },
              severity: { type: "string", enum: ["low", "medium", "high"] },
              explanation: { type: "string", description: "One or two sentences explaining the issue." },
            },
            required: ["file_path", "line_number", "category", "severity", "explanation"],
          },
        },
      },
      required: ["findings"],
    },
  },
} as const;

const MAX_ATTEMPTS = 2;

const EMPTY_RESULT: LLMResult = {
  findings: [],
  promptTokens: 0,
  completionTokens: 0,
  latencyMs: 0,
};

// Only the shape of the Groq response we actually read - not a full
// spec of every field the API can return. That's a deliberate, narrow
// interface rather than "any", which is exactly the point.
interface GroqToolCall {
  function: {
    name: string;
    arguments: string;
  };
}

interface GroqChatCompletionResponse {
  choices?: {
    message?: {
      tool_calls?: GroqToolCall[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export async function reviewDiff(diff: string): Promise<LLMResult> {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }

  if (!diff.trim()) {
    console.warn("reviewDiff: diff is empty, skipping LLM call");
    return EMPTY_RESULT;
  }

  const start = Date.now();
  let res: Response | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
        temperature: 0,
      }),
    });

    if (res.ok) break;

    const body = await res.text();
    const isToolFailure = res.status === 400 && body.includes("tool_use_failed");
    if (!isToolFailure) {
      throw new Error(`Groq API error ${res.status}: ${body}`);
    }

    console.warn(`reviewDiff: tool_use_failed (attempt ${attempt}/${MAX_ATTEMPTS})`);
  }

  const latencyMs = Date.now() - start;

  if (!res || !res.ok) {
    return { ...EMPTY_RESULT, latencyMs };
  }

  const data = (await res.json()) as GroqChatCompletionResponse;
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

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
    findings = [];
  }

  return {
    findings,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    latencyMs,
  };
}