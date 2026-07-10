// Turns Congressional Record prose into structured absence reasons using the
// Claude API. Skips gracefully (empty map) when ANTHROPIC_API_KEY is unset —
// the report then shows absences with "Undisclosed" reasons.
import Anthropic from "@anthropic-ai/sdk";
import { log } from "./lib.js";

const SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          bioguide: {
            type: "string",
            description: "The bioguide ID of the member, copied exactly from the candidate list",
          },
          reason: {
            type: "string",
            description:
              "Short NFL-injury-report style reason, e.g. 'medical procedure', 'family obligation', 'attending funeral services', 'official travel'. Lowercase, under 10 words.",
          },
          detail: {
            type: "string",
            description: "One sentence with the specifics from the source text",
          },
          onLeave: {
            type: "boolean",
            description: "true only if the member was formally granted a leave of absence",
          },
          source: {
            type: "string",
            description: "Which document this came from, e.g. 'Congressional Record 2026-06-30'",
          },
        },
        required: ["bioguide", "reason", "detail", "onLeave", "source"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

export async function extractReasons(candidates, record) {
  if (!process.env.ANTHROPIC_API_KEY) {
    log("reasons", "ANTHROPIC_API_KEY not set — skipping reason extraction");
    return new Map();
  }
  if (candidates.length === 0 || (record.absenceTexts.length === 0 && !record.cloakroomText)) {
    log("reasons", "nothing to extract (no candidates or no source text)");
    return new Map();
  }

  const candidateList = candidates
    .map((m) => `- ${m.bioguide}: ${m.name} (${m.party}-${m.state}, ${m.chamber})`)
    .join("\n");

  const sources = record.absenceTexts
    .map((t) => `### Congressional Record ${t.issueDate} — ${t.title}\n${t.text}`)
    .join("\n\n");
  const cloakroom = record.cloakroomText
    ? `### House Republican Cloakroom leave-of-absence page\n${record.cloakroomText}`
    : "";

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system:
      "You extract structured absence information about members of Congress from official texts. " +
      "Only report findings for members in the provided candidate list, matched confidently by name and state. " +
      "Personal explanations ('had I been present, I would have voted...') often state a reason — extract it when present; " +
      "if a member explains missed votes without giving a reason, do not invent one and do not include them. " +
      "Leave-of-absence grants in the Record are formal leaves (onLeave: true) even when no reason is stated — " +
      "include those with reason 'granted leave of absence'.",
    messages: [
      {
        role: "user",
        content:
          `Candidate members (currently absent per roll-call data):\n${candidateList}\n\n` +
          `Source texts:\n\n${sources}\n\n${cloakroom}`,
      },
    ],
  });

  const reasons = new Map();
  try {
    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    const { findings } = JSON.parse(text);
    const valid = new Set(candidates.map((m) => m.bioguide));
    for (const f of findings ?? []) {
      if (valid.has(f.bioguide)) {
        reasons.set(f.bioguide, {
          reason: f.reason,
          detail: f.detail,
          onLeave: f.onLeave,
          source: f.source,
        });
      }
    }
  } catch (err) {
    log("reasons", `failed to parse extraction output: ${err.message}`);
  }

  log("reasons", `extracted reasons for ${reasons.size} of ${candidates.length} candidates`);
  return reasons;
}
