// Builds the "Today in Congress" agenda from the Congressional Record Daily
// Digest (which recaps the last session day and lists what's scheduled next).
// Uses the Claude API to structure it; without a key, emits a minimal agenda
// so the page still renders with links to official sources.
import Anthropic from "@anthropic-ai/sdk";
import { log, todayIso } from "./lib.js";

const SCHEMA = {
  type: "object",
  properties: {
    headline: {
      type: "string",
      description: "One punchy sentence on the biggest thing happening in Congress, sports-broadcast tone",
    },
    chambers: {
      type: "object",
      properties: {
        senate: { $ref: "#/$defs/chamber" },
        house: { $ref: "#/$defs/chamber" },
      },
      required: ["senate", "house"],
      additionalProperties: false,
    },
    committees: {
      type: "array",
      description: "Up to 6 notable committee meetings scheduled, empty if none",
      items: {
        type: "object",
        properties: {
          chamber: { type: "string", enum: ["senate", "house", "joint"] },
          committee: { type: "string" },
          topic: { type: "string" },
        },
        required: ["chamber", "committee", "topic"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "chambers", "committees"],
  additionalProperties: false,
  $defs: {
    chamber: {
      type: "object",
      properties: {
        nextMeeting: {
          type: "string",
          description: "When the chamber next convenes, e.g. 'Wednesday, July 9 at 10:00 AM', or 'Not in session' ",
        },
        lastSessionSummary: {
          type: "string",
          description: "2-3 sentences summarizing what happened on the floor in the most recent session",
        },
        onTheFloor: {
          type: "array",
          description: "Bills/measures being debated or scheduled for votes, most important first, max 8",
          items: {
            type: "object",
            properties: {
              measure: { type: "string", description: "e.g. 'H.R. 1234' or 'S. 567', or a short name if unnumbered" },
              title: { type: "string", description: "Plain-English one-line description of what it does" },
              status: { type: "string", description: "e.g. 'passed 218-210', 'debate scheduled', 'cloture vote expected'" },
            },
            required: ["measure", "title", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["nextMeeting", "lastSessionSummary", "onTheFloor"],
      additionalProperties: false,
    },
  },
};

export async function buildAgenda(record) {
  const base = {
    generatedAt: new Date().toISOString(),
    reportDate: todayIso(),
    recordIssueDate: record.issues[0] ?? null,
  };

  if (!process.env.ANTHROPIC_API_KEY || record.digestTexts.length === 0) {
    log("agenda", "skipping agenda summary (no API key or no Daily Digest)");
    return { ...base, available: false };
  }

  const digest = record.digestTexts
    .map((t) => `### ${t.title} (${t.issueDate})\n${t.text}`)
    .join("\n\n")
    .slice(0, 120000);

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system:
      "You summarize the Congressional Record Daily Digest into a structured daily agenda for a public-facing " +
      "'Today in Congress' page. Be accurate and specific — real bill numbers, real vote tallies, real times. " +
      "Write descriptions in plain English a non-expert can follow. Light sports-desk energy is welcome in the " +
      "headline, but the facts must be straight from the source text.",
    messages: [{ role: "user", content: `Today is ${todayIso()}.\n\nDaily Digest:\n\n${digest}` }],
  });

  try {
    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    const agenda = JSON.parse(text);
    log("agenda", `built agenda from Daily Digest ${base.recordIssueDate}`);
    return { ...base, available: true, ...agenda };
  } catch (err) {
    log("agenda", `failed to parse agenda output: ${err.message}`);
    return { ...base, available: false };
  }
}
