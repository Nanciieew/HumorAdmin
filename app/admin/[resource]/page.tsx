import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin/page";
import { findAdminResource } from "@/lib/admin/resources";
import { listResource } from "@/lib/admin/resource-server";
import { adminSearchParams } from "../search-params";
import { ResourceConsole } from "../resource-console";

export default async function ResourcePage({ params, searchParams }: {
  params: Promise<{ resource: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { resource: slug } = await params;
  const resource = findAdminResource(slug);
  if (!resource) notFound();
  const query = adminSearchParams(await searchParams);
  await requireAdminPage(`/admin/${slug}${query.size ? `?${query}` : ""}`);
  return <ResourceConsole key={`${slug}:${query}`} resource={resource} params={query.toString()} data={await listResource(slug, query)} />;
}
