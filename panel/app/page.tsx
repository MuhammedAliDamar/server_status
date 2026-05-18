import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import Dashboard from "./_components/Dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await isAuthenticated())) redirect("/login");
  return <Dashboard />;
}
