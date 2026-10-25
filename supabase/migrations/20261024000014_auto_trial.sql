-- Every new account starts with a 14-day Team trial (all 8 tools, 3
-- workspaces, 15 people each), as the pricing page promises. When it ends the
-- account falls back to Free limits automatically (account_entitlements
-- treats a lapsed trial as Free); nothing is deleted. Existing accounts keep
-- their current plan.

create or replace function public.create_default_account_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_subscriptions (user_id, plan_id, status, trial_ends_at)
  values (new.id, 'team', 'trialing', now() + interval '14 days')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.create_default_account_subscription() from public, anon, authenticated;
