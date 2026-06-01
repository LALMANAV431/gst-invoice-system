import { db } from "./db";

export type SiteSettings = Record<string, string>;

/** Reads all site settings into a key→value map (safe defaults if missing). */
export async function getSiteSettings(): Promise<SiteSettings> {
  const defaults: SiteSettings = {
    site_name: "GST Books",
    support_phone: "",
    support_email: "",
    whatsapp_number: "",
    address: "",
    announcement: "",
    announcement_active: "false",
    facebook_url: "",
    instagram_url: "",
    twitter_url: "",
  };
  try {
    const rows = await db.siteSetting.findMany();
    for (const r of rows) defaults[r.key] = r.value ?? "";
  } catch {
    // table not migrated yet
  }
  return defaults;
}
