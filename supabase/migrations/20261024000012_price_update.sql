-- Price update: Team $29 → $35 a month ($350 a year), Business $79 → $89 a
-- month ($890 a year). Annual stays at ten months' price (two months free).
-- Limits are unchanged. Estimated MRR in the admin console uses these list
-- prices straight away; no payment provider is connected, so nobody is charged
-- differently until billing is set up.

update public.plans set monthly_price_cents = 3500, annual_price_cents = 35000 where id = 'team';
update public.plans set monthly_price_cents = 8900, annual_price_cents = 89000 where id = 'business';
