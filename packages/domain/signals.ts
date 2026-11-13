import type { Message, Signal } from "./types";

// The model classifies evidence, but these versioned rules (not model-provided
// numbers) calculate the scores. Exact source quotations are mandatory.
export function extractScores(
  signals: Signal[],
  messages: Message[],
  now = Date.now(),
) {
  const source = new Map(
    messages.filter((m) => m.direction === "in").map((m) => [m.id, m]),
  );
  const valid = signals.filter(
    (s) => s.quote.trim() && source.get(s.messageId)?.text.includes(s.quote),
  );
  const recent = valid.filter(
    (s) => now - source.get(s.messageId)!.timestamp <= 14 * 86_400_000,
  );
  const topics = new Set(
    recent
      .filter((s) => s.kind === "answered_question" && s.topic)
      .map((s) => s.topic),
  );
  const question = recent.some((s) => s.kind === "asked_question");
  const step = recent.some((s) => s.kind === "next_step");
  const engagement = recent.some((s) => s.kind === "cancelled")
    ? 0
    : topics.size >= 2 && question && step
      ? 100
      : topics.size >= 2 && question
        ? 80
        : topics.size >= 2
          ? 60
          : topics.size === 1
            ? 40
            : recent.some((s) => s.kind === "greeting")
              ? 20
              : null;
  const levels: Partial<Record<Signal["kind"], number>> = {
    interest: 20,
    specification: 40,
    quantity_inquiry: 60,
    formal_quote: 80,
    order_intent: 100,
    cancelled: 0,
  };
  const intentSignals = valid
    .filter(
      (s) =>
        levels[s.kind] !== undefined &&
        now - source.get(s.messageId)!.timestamp <= 30 * 86_400_000,
    )
    .sort(
      (a, b) =>
        source.get(a.messageId)!.timestamp - source.get(b.messageId)!.timestamp,
    );
  const lastCancellation = intentSignals
    .map((s) => s.kind)
    .lastIndexOf("cancelled");
  const afterCancellation = intentSignals.slice(lastCancellation + 1);
  const intent = afterCancellation.length
    ? Math.max(...afterCancellation.map((s) => levels[s.kind]!))
    : lastCancellation >= 0
      ? 0
      : null;
  return { engagement, intent, fit: null, signals: valid };
}
