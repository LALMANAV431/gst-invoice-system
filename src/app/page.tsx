import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getSiteSettings } from "@/lib/settings";
import Landing from "@/components/Landing";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (session) redirect("/dashboard");
  const settings = await getSiteSettings();
  return (
    <Landing
      announcement={settings.announcement_active === "true" ? settings.announcement : ""}
      supportPhone={settings.support_phone}
      supportEmail={settings.support_email}
      address={settings.address}
    />
  );
}
