import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import ServerDetail from "./_components/ServerDetail";

export const dynamic = "force-dynamic";

export default async function ServerPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) redirect("/login");
  const { id } = await params;
  const server = await prisma.server.findUnique({ where: { id } });
  if (!server) notFound();
  return <ServerDetail serverId={server.id} serverName={server.name} />;
}
