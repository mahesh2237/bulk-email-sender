export type RecipientStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export interface Recipient {
  id: string;
  email: string;
  data: Record<string, string>;
  status: RecipientStatus;
  sentAt?: number;
  error?: string;
}

export interface CampaignSettings {
  minDelaySeconds: number;
  maxDelaySeconds: number;
  stopOnError: boolean;
  emailColumn: string;
}

export interface CampaignLog {
  id: string;
  timestamp: number;
  type: "info" | "success" | "warning" | "error";
  message: string;
}

export type CampaignStatus = "idle" | "running" | "paused" | "completed" | "stopped";

export interface CampaignState {
  id: string;
  name: string;
  subject: string;
  body: string;
  recipients: Recipient[];
  columns: string[];
  settings: CampaignSettings;
  status: CampaignStatus;
  currentIndex: number;
  stats: {
    total: number;
    sent: number;
    failed: number;
    pending: number;
  };
  logs: CampaignLog[];
  updatedAt: number;
}
