import type { Analysis, Message, Scores } from "./types";

const day = 86_400_000;
export const completenessWeights: Record<string, number> = {
  company: 15,
  role: 10,
  market: 10,
  product: 15,
  specifications: 20,
  quantity: 15,
  timeline: 10,
  budget: 5,
};
export function score(
  messages: Message[],
  analysis: Analysis | null,
  now = Date.now(),
): Scores {
  const incoming = messages
    .filter((m) => m.direction === "in" && m.kind === "text" && m.text.trim())
    .sort((a, b) => a.timestamp - b.timestamp);
  const turns: Message[] = [];
  for (const m of incoming) {
    const previous = turns.at(-1);
    if (
      !previous ||
      (m.timestamp - previous.timestamp > 20_000 && previous.text !== m.text)
    )
      turns.push(m);
  }
  const recent = turns.filter((m) => now - m.timestamp <= 7 * day);
  const activeDays = new Set(recent.map((m) => Math.floor(m.timestamp / day)))
    .size;
  const last = turns.at(-1);
  const activity = last
    ? Math.round(
        100 *
          (0.4 * Math.min(activeDays / 4, 1) +
            0.3 * Math.min(recent.length / 10, 1) +
            0.3 * 2 ** (-Math.max(0, now - last.timestamp) / day / 7)),
      )
    : null;
  const completeness = analysis
    ? Object.entries(completenessWeights).reduce(
        (n, [key, weight]) =>
          n + (analysis.facts[key]?.value.trim() ? weight : 0),
        0,
      )
    : null;
  const dimensions = [
    { label: "互动积极度", value: analysis?.engagement ?? null, weight: 25 },
    { label: "信息完整度", value: completeness, weight: 20 },
    { label: "对话活跃度", value: activity, weight: 15 },
    { label: "购买意向度", value: analysis?.intent ?? null, weight: 30 },
    { label: "产品匹配度", value: analysis?.fit ?? null, weight: 10 },
  ];
  const coverage = dimensions.reduce(
    (n, d) => n + (d.value === null ? 0 : d.weight),
    0,
  );
  const total = coverage
    ? Math.round(
        dimensions.reduce((n, d) => n + (d.value ?? 0) * d.weight, 0) /
          coverage,
      )
    : null;
  const provisional = turns.length < 3 || coverage < 60 || total === null;
  const grade = provisional
    ? "观察中"
    : total >= 80
      ? "A"
      : total >= 60
        ? "B"
        : total >= 40
          ? "C"
          : "D";
  return { total, grade, coverage, dimensions, turns: turns.length };
}
