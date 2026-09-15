import { Storage } from "@plasmohq/storage";
import type { CampaignState } from "./types";

export const storage = new Storage({
  area: "local"
});

export const DEFAULT_CAMPAIGN: CampaignState = {
  id: "default-campaign",
  name: "New Bulk Campaign",
  subject: "Quick question for {{First Name|there}}",
  body: "Hi {{First Name|there}},\n\nI noticed your work at {{Company|your company}} and wanted to reach out.\n\nBest regards,\nMahesh",
  recipients: [],
  columns: [],
  settings: {
    minDelaySeconds: 5,
    maxDelaySeconds: 12,
    stopOnError: false,
    emailColumn: "Email"
  },
  status: "idle",
  currentIndex: 0,
  stats: {
    total: 0,
    sent: 0,
    failed: 0,
    pending: 0
  },
  logs: [],
  updatedAt: Date.now()
};

export async function getActiveCampaign(): Promise<CampaignState> {
  const current = await storage.get<CampaignState>("active_campaign");
  if (!current) {
    await storage.set("active_campaign", DEFAULT_CAMPAIGN);
    return DEFAULT_CAMPAIGN;
  }
  return current;
}

export async function saveActiveCampaign(campaign: CampaignState): Promise<void> {
  campaign.updatedAt = Date.now();
  await storage.set("active_campaign", campaign);
}
