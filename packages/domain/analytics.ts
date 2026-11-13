export type ReportKind = "week" | "month";
export interface ReportRequest {
  kind: ReportKind;
  anchor: string;
}
export interface ReportPeriod {
  start: number;
  end: number;
  cutoff: number;
  previousStart: number;
  previousEnd: number;
  previousCutoff: number;
  label: string;
  startDate: string;
  endDate: string;
  partial: boolean;
  timezone: "Asia/Shanghai";
}
export interface CustomerMeasure {
  id: string;
  name: string;
  firstInbound: number | null;
  incoming: number;
  outgoing: number;
  firstMessage: number;
  lastMessage: number;
  replied: boolean;
  isNew: boolean;
}
export interface ReportTotals {
  active: number;
  newCustomers: number;
  incoming: number;
  outgoing: number;
  replied: number;
  replyCoverage: number | null;
}
export interface QuestionCategory {
  id: string;
  label: string;
  count: number;
  customers: number;
  examples: {
    messageId: string;
    chatId: string;
    name: string;
    text: string;
    at: number;
  }[];
}
export interface CustomerReport {
  request: ReportRequest;
  period: ReportPeriod;
  generatedAt: number;
  earliestInbound: number | null;
  totals: ReportTotals;
  previous: ReportTotals;
  historicalIncoming: number;
  trend: {
    date: string;
    newCustomers: number;
    active: number;
    incoming: number;
    outgoing: number;
  }[];
  categories: QuestionCategory[];
  customers: CustomerMeasure[];
  summary: string[];
  suggestions: string[];
  coverage: { firstSeenCustomers: number; totalCustomers: number };
  revision: number;
}
