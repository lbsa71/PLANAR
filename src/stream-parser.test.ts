import { describe, it, expect } from "vitest";
import {
  parseStreamChunk,
  summarizeEvent,
  extractCost,
  isRateLimitError,
  isRateLimitErrorAt,
} from "./stream-parser.js";

describe("parseStreamChunk", () => {
  it("parses complete lines", () => {
    const buffer = '{"type":"system","subtype":"init"}\n{"type":"result"}\n';
    const { events, remainder } = parseStreamChunk(buffer);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("system");
    expect(events[1].type).toBe("result");
    expect(remainder).toBe("");
  });

  it("keeps incomplete last line as remainder", () => {
    const buffer = '{"type":"system"}\n{"type":"res';
    const { events, remainder } = parseStreamChunk(buffer);
    expect(events).toHaveLength(1);
    expect(remainder).toBe('{"type":"res');
  });

  it("skips empty lines", () => {
    const buffer = '\n\n{"type":"system"}\n\n';
    const { events } = parseStreamChunk(buffer);
    expect(events).toHaveLength(1);
  });

  it("skips unparseable lines", () => {
    const buffer = 'not json\n{"type":"system"}\n';
    const { events } = parseStreamChunk(buffer);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("system");
  });
});

describe("summarizeEvent", () => {
  it("summarizes init", () => {
    expect(summarizeEvent({ type: "system", subtype: "init" })).toBe(
      "Session initialized"
    );
  });

  it("summarizes tool_use with file_path", () => {
    const event = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: "/src/card.ts" },
          },
        ],
      },
    };
    expect(summarizeEvent(event)).toBe("Read: card.ts");
  });

  it("summarizes tool_use with command", () => {
    const event = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "npm test" },
          },
        ],
      },
    };
    expect(summarizeEvent(event)).toBe("Bash: npm test");
  });

  it("summarizes text as thinking", () => {
    const event = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Let me analyze the code..." }],
      },
    };
    expect(summarizeEvent(event)).toBe("Thinking: Let me analyze the code...");
  });

  it("summarizes result with cost", () => {
    const event = {
      type: "result",
      subtype: "success",
      total_cost_usd: 0.0635,
    };
    expect(summarizeEvent(event)).toBe("Completed ($0.0635)");
  });

  it("returns null for tool_result", () => {
    expect(summarizeEvent({ type: "tool_result" })).toBeNull();
  });

  it("summarizes rejected rate limit events with reset time", () => {
    expect(
      summarizeEvent({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          resetsAt: 1773752400,
        },
      })
    ).toContain("Rate limit: rejected");
  });
});

describe("extractCost", () => {
  it("extracts cost from result event", () => {
    expect(
      extractCost({ type: "result", total_cost_usd: 0.05 })
    ).toBeCloseTo(0.05);
  });

  it("returns null for non-result events", () => {
    expect(extractCost({ type: "assistant" })).toBeNull();
  });

  it("returns null when no cost field", () => {
    expect(extractCost({ type: "result" })).toBeNull();
  });
});

describe("isRateLimitError", () => {
  it("detects rate limit in error result", () => {
    const result = isRateLimitError({
      type: "result",
      is_error: true,
      result: "rate_limit_error: too many requests",
    });
    expect(result).toEqual({ retryAfterSecs: 60 });
  });

  it("detects rejected rate_limit_event and uses resetsAt timestamp", () => {
    const result = isRateLimitErrorAt(
      {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          resetsAt: 102,
          rateLimitType: "five_hour",
        },
      },
      100_000
    );
    expect(result).toEqual({
      retryAfterSecs: 2,
      resetsAt: 102,
      status: "rejected",
      rateLimitType: "five_hour",
    });
  });

  it("ignores non-rejected rate_limit_event statuses", () => {
    expect(
      isRateLimitError({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed_warning",
          resetsAt: 1773752400,
        },
      })
    ).toBeNull();
  });

  it("returns null for success", () => {
    expect(
      isRateLimitError({ type: "result", subtype: "success", is_error: false })
    ).toBeNull();
  });

  it("returns null for non-result events", () => {
    expect(isRateLimitError({ type: "assistant" })).toBeNull();
  });
});
