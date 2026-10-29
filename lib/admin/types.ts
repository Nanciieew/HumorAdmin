export type AdminAccount = {
  id: string; email: string | null; account_created_at: string; profile_created_at: string | null;
  first_name: string | null; last_name: string | null; state_code: string | null;
  onboarding_completed_at: string | null; is_superadmin: boolean;
};
export type AdminMedia = {
  id: string; contributor_id: string; owner_name: string; source: "upload" | "generated";
  title: string; description: string; created_at: string; published_at: string | null;
  upvotes: string; downvotes: string;
};
export type AdminVote = {
  photo_id?: string; challenge_id?: string; voter_id: string; voter_name: string;
  value?: number; title?: string; target_id?: string; target_name?: string;
};
export type AdminPage<T> = { items: T[]; total: string };
export type AdminOverview = {
  total_users: string; new_users_this_month: string; total_memes: string; total_egos: string;
  month_start: string; month_end: string; updated_at: string;
};
