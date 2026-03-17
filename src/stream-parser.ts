/**
 * Parse Claude Code stream-json events from a stdout data chunk.
 * Events are newline-delimited JSON objects.
 */

export interface StreamEvent {
  type: string;
  subtype?: string;
  [key: string]: unknown;
}

/** Summarize a stream event into a short human-readable string for the dashboard */
export function summarizeEvent(event: StreamEvent): string | null {
  switch (event.type) {
    case "system":
      if (event.subtype === "init") return "Session initialized";
      return null;

    case "assistant": {
      const message = event.message as {
        content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
      } | undefined;
      if (!message?.content) return null;

      for (const block of message.content) {
        if (block.type === "tool_use") {
          const toolName = block.name ?? "unknown";
          const input = block.input;
          // Show what file/pattern the tool is operating on
          if (input) {
            if ("file_path" in input) return `${toolName}: ${basename(String(input.file_path))}`;
            if ("path" in input) return `${toolName}: ${basename(String(input.path))}`;
            if ("pattern" in input) return `${toolName}: ${input.pattern}`;
            if ("command" in input) return `${toolName}: ${truncate(String(input.command), 50)}`;
          }
          return `${toolName}`;
        }
        if (block.type === "text" && block.text) {
          return `Thinking: ${truncate(block.text, 60)}`;
        }
      }
      return null;
    }

    case "tool_result":
      return null; // Tool results are verbose, skip

    case "rate_limit_event": {
      const info = event.rate_limit_info as {
        status?: string;
        resetsAt?: number;
        rateLimitType?: string;
      } | undefined;
      if (!info) return null;
      if (info.status === "allowed") return null; // Normal — don't clutter the feed
      // Surface non-allowed statuses
      const resets = info.resetsAt
        ? ` (resets ${new Date(info.resetsAt * 1000).toLocaleTimeString()})`
        : "";
      return `Rate limit: ${info.status}${resets}`;
    }

    case "result": {
      const cost = event.total_cost_usd as number | undefined;
      const costStr = cost !== undefined ? ` ($${cost.toFixed(4)})` : "";
      if (event.subtype === "success") return `Completed${costStr}`;
      if (event.is_error) return `Error${costStr}`;
      return `Finished${costStr}`;
    }

    default:
      return null;
  }
}

/** Extract cost from a result event, or null */
export function extractCost(event: StreamEvent): number | null {
  if (event.type === "result" && typeof event.total_cost_usd === "number") {
    return event.total_cost_usd;
  }
  return null;
}

/** Check if this is a rate limit error event */
export function isRateLimitError(event: StreamEvent): { retryAfterSecs: number } | null {
  if (event.type === "result" && event.is_error) {
    // Check for rate limit in the result
    const result = String(event.result ?? "");
    if (result.includes("rate_limit") || result.includes("overloaded")) {
      return { retryAfterSecs: 60 };
    }
  }
  return null;
}

/** Parse a buffer of potentially multiple newline-delimited JSON events */
export function parseStreamChunk(
  buffer: string
): { events: StreamEvent[]; remainder: string } {
  const events: StreamEvent[] = [];
  const lines = buffer.split("\n");
  // Last element may be incomplete — keep it as remainder
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Skip unparseable lines
    }
  }

  return { events, remainder };
}

function basename(filepath: string): string {
  const parts = filepath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? filepath;
}

function truncate(s: string, maxLen: number): string {
  const cleaned = s.replace(/\n/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 1) + "…";
}
