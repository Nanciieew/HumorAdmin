import "server-only";
import { supabase } from "@/lib/supabase";
import { AdminError, requireAdmin } from "./auth";
import type { AdminOverview } from "./types";

export async function readAdminOverview(): Promise<AdminOverview> {
  await requireAdmin();
  const result = await supabase.rpc("admin_overview");
  const data = result.data as AdminOverview | null;
  const counts = ["total_users", "new_users_this_month", "total_memes", "total_egos"] as const;
  const dates = ["month_start", "month_end", "updated_at"] as const;
  if (result.error || !data || counts.some(key => typeof data[key] !== "string" || !/^\d+$/.test(data[key])) ||
    dates.some(key => typeof data[key] !== "string" || !Number.isFinite(Date.parse(data[key])))) {
    throw new AdminError("Unable to load overview totals. Please try again.", 503);
  }
  return data;
}
