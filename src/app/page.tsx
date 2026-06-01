import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import Landing from "@/components/Landing";

export default async function HomePage() {
  const session = await getSession();
  if (session) redirect("/dashboard");
  return <Landing />;
}
