export type Mode = "AUTO" | "ASSIST" | "HUMAN" | "PAUSED";
export type Connection =
  | "disconnected"
  | "connecting"
  | "qr"
  | "connected"
  | "logged_out"
  | "error";
export interface Message {
  id: string;
  chatId: string;
  direction: "in" | "out";
  text: string;
  timestamp: number;
  kind: "text" | "image" | "document" | "unsupported";
  historical: boolean;
  status: string;
  translation?: string;
  assetId?: string;
  mediaName?: string;
  mediaState?: "pending" | "ready" | "failed" | "unavailable";
}
export interface Evidence {
  messageId: string;
  quote: string;
}
export interface Signal extends Evidence {
  kind:
    | "greeting"
    | "answered_question"
    | "asked_question"
    | "next_step"
    | "interest"
    | "specification"
    | "quantity_inquiry"
    | "formal_quote"
    | "order_intent"
    | "cancelled";
  topic?: string;
}
export interface Fact {
  value: string;
  evidence: Evidence;
}
export interface Analysis {
  summary: string;
  needs: string[];
  nextSteps: string[];
  uncertainties: string[];
  facts: Record<string, Fact>;
  engagement: number | null;
  intent: number | null;
  fit: number | null;
  signals: Signal[];
  generatedAt: number;
  revision: number;
}
export interface Scores {
  total: number | null;
  grade: "A" | "B" | "C" | "D" | "观察中";
  coverage: number;
  dimensions: { label: string; value: number | null; weight: number }[];
  turns: number;
}
export interface Chat {
  id: string;
  name: string;
  mode: Mode;
  revision: number;
  updatedAt: number;
  lastText: string;
  analysis: Analysis | null;
  draft: string;
  scores: Scores;
  location?: import("./location").CustomerLocation;
}
export interface CustomerProfile {
  state: "online" | "unavailable" | "typing" | "recording" | "unknown";
  updatedAt: number;
  lastSeen?: number;
  avatarVersion: number;
}
export interface GeneratedReply {
  draft: string;
  revision: number;
}
export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  tested: boolean;
  jsonMode: boolean;
}
export interface Settings {
  globalAuto: boolean;
  cloudConsent: boolean;
  riskConsent: boolean;
  providerId: string;
  tone: string;
  language: string;
  companyInfo: string;
  boundaries: string;
  maxRepliesPerHour: number;
}
export interface Asset {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  hash: string;
  text: string;
  aiReadable: boolean;
  replyUsable: boolean;
  external: boolean;
  chatId: string;
  createdAt: number;
  origin?: "library" | "chat";
  folderId?: string;
}
export interface LibraryFolder {
  id: string;
  name: string;
  createdAt: number;
}
export interface Audit {
  id: number;
  at: number;
  action: string;
  detail: string;
  chatId: string;
}
export interface Outbox {
  id: string;
  chatId: string;
  text: string;
  assetId: string | null;
  status: "queued" | "sending" | "sent" | "unknown" | "cancelled";
  createdAt: number;
  providerId: string | null;
  automatic: boolean;
  revision: number;
}
export interface Snapshot {
  connection: Connection;
  connectionDetail: string;
  qr: string | null;
  settings: Settings;
  providers: Provider[];
  chats: Chat[];
  assets: Asset[];
  audits: Audit[];
  outbox: Outbox[];
  dataDir: string;
  version: string;
  folders: LibraryFolder[];
  customerProfiles: Record<string, CustomerProfile>;
  customerAliases?: Record<string, string>;
  trash: { id: string; name: string; deletedAt: number }[];
}
export interface DesktopAPI {
  backupStatus(): Promise<BackupState>;
  createBackup(password: string): Promise<BackupResult>;
  restoreBackup(password: string): Promise<BackupResult>;
  snapshot(): Promise<Snapshot>;
  report(request: ReportRequest): Promise<CustomerReport>;
  exportReport(request: ReportRequest): Promise<void>;
  messages(chatId: string): Promise<Message[]>;
  renameChat(chatId: string, name: string): Promise<void>;
  setLocation(chatId: string, country: string, timeZone: string): Promise<void>;
  deleteChat(chatId: string): Promise<boolean>;
  restoreChat(chatId: string): Promise<void>;
  image(chatId: string, messageId: string): Promise<string>;
  previewFile(chatId: string, messageId: string): Promise<void>;
  closePreview(): Promise<void>;
  settings(value: Settings): Promise<void>;
  saveProvider(
    value: Omit<Provider, "hasKey" | "tested"> & { apiKey: string },
  ): Promise<void>;
  testProvider(id: string): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  mode(chatId: string, mode: Mode): Promise<void>;
  watchCustomers(ids: string[]): Promise<void>;
  customerProfiles(): Promise<Record<string, CustomerProfile>>;
  onCustomerChange(callback: () => void): () => void;
  customerAvatar(chatId: string): Promise<string | null>;
  generate(chatId: string): Promise<GeneratedReply | null>;
  analyze(chatId: string): Promise<boolean>;
  send(chatId: string, text: string, assetId?: string): Promise<void>;
  translate(chatId: string, messageId: string): Promise<string>;
  importAsset(folderId?: string): Promise<void>;
  saveFolder(id: string, name: string): Promise<void>;
  removeFolder(id: string): Promise<void>;
  moveAssets(ids: string[], folderId: string): Promise<void>;
  setExternal(ids: string[], enabled: boolean): Promise<void>;
  previewAsset(id: string): Promise<void>;
  assetText(id: string): Promise<string>;
  saveAssetText(id: string, text: string): Promise<void>;
  exportChat(chatId: string): Promise<void>;
  onChange(callback: () => void): () => void;
}
export interface BackupState {
  busy: boolean;
  phase: string;
  percent: number;
  lastBackup?: { path: string; at: string };
}
export interface BackupResult {
  cancelled: boolean;
  path?: string;
  restarting?: boolean;
}
declare global {
  interface Window {
    smarChat: DesktopAPI;
  }
}
import type { CustomerReport, ReportRequest } from "./analytics";
