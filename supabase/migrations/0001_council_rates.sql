-- council-rates-for-claude-code: core schema.
-- A New Zealand council's property and rating system: the rating units on the
-- district valuation roll, their values and differential categories, the
-- ratepayers on the rating information database, the rates set by resolution
-- each year, the strike that turns them into rates assessments, instalment
-- invoices, the rates ledger, penalties, arrears and the steps that follow,
-- remissions and postponements, rates rebates and objections.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
--
-- Money is stored in cents, GST inclusive, as councils set rates. The ledger is a
-- RECORD of what was charged and received: payments are taken by the council's
-- bank and receipting system and recorded here. This database never takes a
-- payment, never posts to the general ledger and never makes the valuation: the
-- values come from the council's valuation service provider.
--
-- The rules the Local Government (Rating) Act 2002 puts on the numbers live in
-- the database, not in a screen: penalties above 10 percent are refused (s 58),
-- an instalment cannot be invoiced before its rates assessment has gone out
-- (s 48), a penalty cannot be added twice or before its date, a mortgagee cannot
-- be asked to pay before s 62 allows, and the ledger is append only. docs/compliance.md cites each one.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Working days, for s 58(1)(b): five working days after the resolution.
create or replace function add_working_days(d date, n integer) returns date
language plpgsql immutable as $$
declare out date := d; left_n integer := n;
begin
  while left_n > 0 loop
    out := out + 1;
    if extract(isodow from out) < 6 then left_n := left_n - 1; end if;
  end loop;
  return out;
end
$$;

-- The first day of the council's financial year (1 July) that a date falls in.
create or replace function fy_start(d date) returns date
language sql immutable as $$
  select make_date(extract(year from d)::int - case when extract(month from d) < 7 then 1 else 0 end, 7, 1)
$$;

-- ---------------------------------------------------------------- settings

create table settings (
  id boolean primary key default true check (id),
  council_name text not null,
  currency text not null default 'NZD',
  reminder_days integer not null default 14,        -- arrears ladder, council policy
  final_notice_days integer not null default 35,
  mortgagee_days integer not null default 120,
  remission_decision_days integer not null default 20, -- working days, council policy
  valuation_max_age_years integer not null default 3,  -- Rating Valuations Act 1998
  updated_at timestamptz not null default now()
);

create table categories (
  code text primary key,
  name text not null,
  description text
);

-- ---------------------------------------------------------------- the roll

create table rating_units (
  id uuid primary key default gen_random_uuid(),
  assessment_no text not null unique,          -- the council's rating reference
  valuation_ref text unique,                   -- the valuation roll number
  address text not null,
  locality text,
  legal_description text,
  category_code text not null references categories(code),
  land_value_cents bigint not null default 0 check (land_value_cents >= 0),
  capital_value_cents bigint not null default 0 check (capital_value_cents >= 0),
  valuation_date date,
  area_ha numeric(12,4),
  suips integer not null default 1 check (suips >= 0),  -- separately used or inhabited parts
  rateable_pct integer not null default 100 check (rateable_pct in (0, 50, 100)), -- Schedule 1 Parts 1 and 2
  maori_freehold boolean not null default false,
  water_connected boolean not null default false,
  wastewater_connected boolean not null default false,
  refuse_service boolean not null default false,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger rating_units_updated before update on rating_units for each row execute function set_updated_at();

create table ratepayers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  postal_address text,
  email text,
  phone text,
  withhold_name boolean not null default false,
  withhold_requested_on date,
  external_ref text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ratepayers_updated before update on ratepayers for each row execute function set_updated_at();

create table unit_ratepayers (
  id uuid primary key default gen_random_uuid(),
  rating_unit_id uuid not null references rating_units(id),
  ratepayer_id uuid not null references ratepayers(id),
  role text not null default 'owner' check (role in ('owner', 'lessee')),
  from_on date not null,
  until_on date,
  created_at timestamptz not null default now(),
  check (until_on is null or until_on >= from_on)
);
create index unit_ratepayers_unit on unit_ratepayers (rating_unit_id) where until_on is null;

create table mortgagees (
  id uuid primary key default gen_random_uuid(),
  rating_unit_id uuid not null references rating_units(id),
  lender text not null,
  registered_on date,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- the rates

create table rating_years (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,                  -- 2026/27
  starts_on date not null,
  ends_on date not null,
  resolution_on date,                          -- s 23: rates are set by resolution
  resolution_ref text,
  penalty_resolution_ref text,                 -- s 57: penalties need a resolution too
  penalty_resolution_on date,                  -- s 57(2)(a): no later than the rates are set
  revenue_sought_cents bigint,
  struck_on date,
  created_at timestamptz not null default now(),
  check (ends_on > starts_on)
);

create table rate_types (
  id uuid primary key default gen_random_uuid(),
  rating_year_id uuid not null references rating_years(id),
  code text not null,
  name text not null,
  kind text not null check (kind in ('general', 'uagc', 'targeted')),
  basis text not null check (basis in ('capital_value', 'land_value', 'per_unit', 'per_suip', 'per_connection')),
  rate_per_dollar numeric(18,12),              -- value-based: dollars of rates per dollar of value
  fixed_cents bigint,                          -- fixed charges
  service text check (service in ('water', 'wastewater', 'refuse')),
  categories text[],                           -- null: every category
  excluded_from_cap boolean not null default false, -- s 21: water supply and sewage disposal
  purpose text,
  created_at timestamptz not null default now(),
  unique (rating_year_id, code),
  check ((basis in ('capital_value', 'land_value') and rate_per_dollar is not null)
      or (basis not in ('capital_value', 'land_value') and fixed_cents is not null)),
  check (basis <> 'per_connection' or service is not null)
);

create table rate_differentials (
  rate_type_id uuid not null references rate_types(id),
  category_code text not null references categories(code),
  factor numeric(8,4) not null check (factor >= 0),
  primary key (rate_type_id, category_code)
);

create table instalments (
  id uuid primary key default gen_random_uuid(),
  rating_year_id uuid not null references rating_years(id),
  no integer not null check (no between 1 and 12),
  due_on date not null,
  penalty_on date,
  penalty_pct numeric(5,2) not null default 10 check (penalty_pct >= 0 and penalty_pct <= 10), -- s 58(1)(a)
  issued_on date,
  penalties_applied_on date,
  unique (rating_year_id, no),
  check (penalty_on is null or penalty_on > due_on)
);

create table assessments (
  id uuid primary key default gen_random_uuid(),
  rating_year_id uuid not null references rating_years(id),
  rating_unit_id uuid not null references rating_units(id),
  ratepayer_names text,                        -- as at the strike
  capital_value_cents bigint not null,
  land_value_cents bigint not null,
  category_code text not null,
  total_cents bigint not null,
  issued_on date,                              -- s 44 and s 48: delivered before any invoice
  created_at timestamptz not null default now(),
  unique (rating_year_id, rating_unit_id)
);

create table assessment_lines (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id),
  rate_type_id uuid not null references rate_types(id),
  basis_amount numeric(18,2) not null,         -- dollars of value, or a count of units, parts or connections
  factor numeric(8,4) not null,
  amount_cents bigint not null
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  instalment_id uuid not null references instalments(id),
  rating_unit_id uuid not null references rating_units(id),
  amount_cents bigint not null,
  issued_on date not null,
  unique (instalment_id, rating_unit_id)
);

-- ---------------------------------------------------------------- the ledger

create table ledger (
  id uuid primary key default gen_random_uuid(),
  rating_unit_id uuid not null references rating_units(id),
  rating_year_id uuid references rating_years(id),
  instalment_id uuid references instalments(id),
  kind text not null check (kind in ('arrears_brought_forward', 'rates', 'penalty', 'payment', 'remission', 'rebate', 'write_off', 'refund', 'adjustment')),
  penalty_type text check (penalty_type in ('instalment', 'prior_year', 'further')),
  amount_cents bigint not null check (amount_cents <> 0), -- debit positive, credit negative
  entry_on date not null,
  ref text,
  note text,
  actor text not null,
  created_at timestamptz not null default now(),
  check ((kind = 'penalty') = (penalty_type is not null)),
  check (kind not in ('payment', 'remission', 'rebate', 'write_off') or amount_cents < 0),
  check (kind not in ('rates', 'penalty', 'arrears_brought_forward', 'refund') or amount_cents > 0)
);
create index ledger_unit on ledger (rating_unit_id, entry_on);
create unique index ledger_one_instalment_penalty on ledger (rating_unit_id, instalment_id) where kind = 'penalty' and penalty_type = 'instalment';
create unique index ledger_one_year_penalty on ledger (rating_unit_id, rating_year_id, penalty_type) where kind = 'penalty' and penalty_type in ('prior_year', 'further');

create or replace function ledger_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'the rates ledger is append only: record a correcting entry instead';
end
$$;
create trigger ledger_no_update before update or delete on ledger for each row execute function ledger_append_only();

-- ---------------------------------------------------------------- relief and challenge

create table relief_policies (
  code text primary key,
  name text not null,
  kind text not null check (kind in ('remission', 'postponement')),
  policy_ref text not null,                    -- the adopted policy (LGA 2002 s 102, s 108, s 109, s 110)
  max_pct integer check (max_pct between 0 and 100),
  description text
);

create table relief_applications (
  id uuid primary key default gen_random_uuid(),
  rating_unit_id uuid not null references rating_units(id),
  policy_code text not null references relief_policies(code),
  rating_year_id uuid not null references rating_years(id),
  received_on date not null,
  status text not null default 'received' check (status in ('received', 'approved', 'declined', 'withdrawn')),
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  decided_on date,
  decided_by text,
  reason text,
  created_at timestamptz not null default now(),
  check ((status = 'received') = (decided_on is null))
);

create table rebate_applications (
  id uuid primary key default gen_random_uuid(),
  rating_unit_id uuid not null references rating_units(id),
  applicant text not null,
  rating_year_id uuid not null references rating_years(id),
  received_on date not null,
  household_income_cents bigint,
  dependants integer not null default 0,
  rates_payable_cents bigint,
  rebate_cents bigint check (rebate_cents is null or rebate_cents >= 0),
  status text not null default 'received' check (status in ('received', 'approved', 'declined', 'claimed')),
  decided_on date,
  claimed_on date,                              -- claimed back from the Department of Internal Affairs
  note text,
  created_at timestamptz not null default now()
);

create table objections (
  id uuid primary key default gen_random_uuid(),
  rating_unit_id uuid not null references rating_units(id),
  objector text not null,
  received_on date not null,
  grounds text not null,
  status text not null default 'open' check (status in ('open', 'upheld', 'dismissed', 'withdrawn')),
  decided_on date,
  decided_by text,
  outcome text,
  created_at timestamptz not null default now(),
  check ((status = 'open') = (decided_on is null))
);

create table arrears_actions (
  id uuid primary key default gen_random_uuid(),
  rating_unit_id uuid not null references rating_units(id),
  step text not null check (step in ('reminder', 'final_notice', 'arrangement', 'mortgagee_notice', 'mortgagee_demand', 'legal', 'note')),
  taken_on date not null,
  actor text not null,
  note text,
  created_at timestamptz not null default now()
);

create table activity (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  subject text,
  detail text
);

-- ---------------------------------------------------------------- views

create view v_ratepayer_names as
select u.id as rating_unit_id,
       string_agg(r.name, ' and ' order by ur.from_on, r.name) as ratepayer_names,
       bool_or(r.withhold_name) as any_withheld,
       count(r.id) as ratepayer_count
from rating_units u
left join unit_ratepayers ur on ur.rating_unit_id = u.id and ur.until_on is null
left join ratepayers r on r.id = ur.ratepayer_id
group by u.id;

-- When each debit fell due, so arrears can be aged oldest first.
create view v_ledger_due as
select l.*,
       case when l.kind = 'rates' then coalesce(i.due_on, l.entry_on) else l.entry_on end as due_on
from ledger l
left join instalments i on i.id = l.instalment_id;

-- Balance, what is overdue today, and the oldest due date not yet covered by
-- credits (payments are applied to the oldest debt first).
create view v_unit_balance as
with debits as (
  select rating_unit_id, due_on, amount_cents,
         sum(amount_cents) over (partition by rating_unit_id order by due_on, created_at, id) as running
  from v_ledger_due where amount_cents > 0
), credits as (
  select rating_unit_id, -sum(amount_cents) as paid from ledger where amount_cents < 0 group by rating_unit_id
), oldest as (
  select d.rating_unit_id, min(d.due_on) as oldest_unpaid_due
  from debits d left join credits c on c.rating_unit_id = d.rating_unit_id
  where d.running > coalesce(c.paid, 0)
  group by d.rating_unit_id
), totals as (
  select rating_unit_id,
         sum(amount_cents) as balance_cents,
         sum(case when amount_cents > 0 and due_on > current_date then amount_cents else 0 end) as not_yet_due_cents
  from v_ledger_due group by rating_unit_id
)
select u.id as rating_unit_id, u.assessment_no, u.address,
       coalesce(t.balance_cents, 0) as balance_cents,
       greatest(coalesce(t.balance_cents, 0) - coalesce(t.not_yet_due_cents, 0), 0) as overdue_cents,
       o.oldest_unpaid_due,
       case when o.oldest_unpaid_due < current_date and coalesce(t.balance_cents, 0) - coalesce(t.not_yet_due_cents, 0) > 0
            then current_date - o.oldest_unpaid_due else 0 end as days_overdue
from rating_units u
left join totals t on t.rating_unit_id = u.id
left join oldest o on o.rating_unit_id = u.id;

-- The arrears worklist, with the next step on the council's ladder. A first
-- mortgagee can be asked to pay only 3 months after it was notified and not
-- before 1 November in the financial year after the rates were first assessed
-- (s 62(1)(c)).
create view v_arrears as
with last_step as (
  select distinct on (rating_unit_id) rating_unit_id, step, taken_on
  from arrears_actions where step <> 'note'
  order by rating_unit_id, taken_on desc, created_at desc
), steps as (
  select rating_unit_id,
         bool_or(step = 'reminder') as had_reminder,
         bool_or(step = 'final_notice') as had_final,
         max(taken_on) filter (where step = 'mortgagee_notice') as mortgagee_notified_on,
         bool_or(step = 'mortgagee_demand') as had_demand,
         bool_or(step = 'arrangement') as has_arrangement,
         bool_or(step = 'legal') as had_legal
  from arrears_actions group by rating_unit_id
), base as (
  select b.*, n.ratepayer_names, ls.step as last_step, ls.taken_on as last_step_on,
         exists (select 1 from mortgagees m where m.rating_unit_id = b.rating_unit_id) as has_mortgagee,
         s.mortgagee_notified_on, coalesce(s.had_reminder, false) as had_reminder, coalesce(s.had_final, false) as had_final,
         coalesce(s.had_demand, false) as had_demand, coalesce(s.has_arrangement, false) as has_arrangement, coalesce(s.had_legal, false) as had_legal,
         case when s.mortgagee_notified_on is not null then
           greatest((s.mortgagee_notified_on + interval '3 months')::date, make_date(extract(year from fy_start(b.oldest_unpaid_due))::int + 1, 11, 1))
         end as mortgagee_from,
         st.reminder_days, st.final_notice_days, st.mortgagee_days
  from v_unit_balance b
  cross join settings st
  left join v_ratepayer_names n on n.rating_unit_id = b.rating_unit_id
  left join last_step ls on ls.rating_unit_id = b.rating_unit_id
  left join steps s on s.rating_unit_id = b.rating_unit_id
  where b.overdue_cents > 0
)
select rating_unit_id, assessment_no, address, ratepayer_names, overdue_cents, balance_cents, days_overdue, oldest_unpaid_due,
       last_step, last_step_on, has_mortgagee, mortgagee_notified_on, mortgagee_from,
       case
         when has_arrangement then 'watch the arrangement'
         when mortgagee_notified_on is not null and not had_demand and current_date >= mortgagee_from then 'ask the mortgagee to pay (s 62)'
         when mortgagee_notified_on is not null and not had_demand then 'wait: the mortgagee can be asked from ' || mortgagee_from
         when days_overdue >= mortgagee_days and has_mortgagee and mortgagee_notified_on is null then 'notify the mortgagee (s 62)'
         when days_overdue >= mortgagee_days and not has_mortgagee and not had_legal then 'refer for legal recovery'
         when days_overdue >= final_notice_days and not had_final then 'send the final notice'
         when days_overdue >= reminder_days and not had_reminder then 'send a reminder'
         else 'watch'
       end as next_step
from base;

-- The public copy of the rating information database (s 27, s 28): names a
-- ratepayer asked to withhold are not shown.
create view v_rid_public as
select u.assessment_no, u.valuation_ref, u.address, u.locality, u.legal_description,
       u.category_code, u.land_value_cents, u.capital_value_cents, u.valuation_date, u.area_ha,
       case when n.any_withheld then 'Withheld at the ratepayer''s request' else n.ratepayer_names end as ratepayers
from rating_units u
left join v_ratepayer_names n on n.rating_unit_id = u.id
where u.status = 'active';

-- ---------------------------------------------------------------- the calculation

-- One row per unit and rate type that applies: what the unit pays and why.
-- With p_unit, just that unit, whenever it joined the roll (a part-year assessment).
create or replace function calc_rates(p_year uuid, p_unit uuid default null)
returns table (rating_unit_id uuid, rate_type_id uuid, code text, basis_amount numeric, factor numeric, amount_cents bigint)
language sql stable as $$
  with units as (
    select u.* from rating_units u where u.status = 'active'
      and ((p_unit is null and u.created_on <= (select starts_on from rating_years where id = p_year)) or u.id = p_unit)
  ), applies as (
    select u.id as unit_id, rt.id as rt_id, rt.code, rt.basis, rt.rate_per_dollar, rt.fixed_cents, rt.service,
           coalesce(rd.factor, 1)::numeric as diff,
           -- non-rateable land pays the service rates only; half-rateable land pays half the rest
           case when rt.service is not null then 1 else u.rateable_pct / 100.0 end as rateable,
           u.capital_value_cents, u.land_value_cents, u.suips
    from units u
    join rate_types rt on rt.rating_year_id = p_year
    left join rate_differentials rd on rd.rate_type_id = rt.id and rd.category_code = u.category_code
    where (rt.categories is null or u.category_code = any (rt.categories))
      and (rt.service is null
           or (rt.service = 'water' and u.water_connected)
           or (rt.service = 'wastewater' and u.wastewater_connected)
           or (rt.service = 'refuse' and u.refuse_service))
  )
  select unit_id, rt_id, code,
         case basis when 'capital_value' then capital_value_cents / 100.0
                    when 'land_value' then land_value_cents / 100.0
                    when 'per_suip' then suips
                    else 1 end::numeric as basis_amount,
         diff,
         round(case basis
                 when 'capital_value' then capital_value_cents * rate_per_dollar * diff * rateable
                 when 'land_value' then land_value_cents * rate_per_dollar * diff * rateable
                 when 'per_suip' then fixed_cents * suips * diff * rateable
                 else fixed_cents * diff * rateable end)::bigint
  from applies
  where rateable > 0 and diff > 0
$$;

-- The strike: one rates assessment per active unit, with its lines. Once only.
create or replace function strike_year(p_year uuid, p_on date, p_actor text) returns integer
language plpgsql as $$
declare
  y rating_years%rowtype;
  n integer;
begin
  select * into y from rating_years where id = p_year;
  if y.id is null then raise exception 'no such rating year'; end if;
  if y.struck_on is not null then raise exception 'rating year % was struck on %: the strike runs once', y.label, y.struck_on; end if;
  if y.resolution_on is null then raise exception 'rating year % has no rates resolution: rates are set by resolution (s 23) before they are assessed', y.label; end if;
  if p_on < y.resolution_on then raise exception 'the strike date % is before the rates resolution of %', p_on, y.resolution_on; end if;

  insert into assessments (rating_year_id, rating_unit_id, ratepayer_names, capital_value_cents, land_value_cents, category_code, total_cents, issued_on)
  select p_year, u.id, n.ratepayer_names, u.capital_value_cents, u.land_value_cents, u.category_code,
         coalesce((select sum(c.amount_cents) from calc_rates(p_year) c where c.rating_unit_id = u.id), 0), p_on
  from rating_units u
  left join v_ratepayer_names n on n.rating_unit_id = u.id
  where u.status = 'active' and u.created_on <= y.starts_on;
  get diagnostics n = row_count;

  insert into assessment_lines (assessment_id, rate_type_id, basis_amount, factor, amount_cents)
  select a.id, c.rate_type_id, c.basis_amount, c.factor, c.amount_cents
  from calc_rates(p_year) c join assessments a on a.rating_unit_id = c.rating_unit_id and a.rating_year_id = p_year;

  update rating_years set struck_on = p_on where id = p_year;
  insert into activity (actor, action, subject, detail) values (p_actor, 'strike', y.label, n || ' rates assessments issued on ' || p_on);
  return n;
end
$$;

-- Assessment for a unit added to the roll after the strike (a new subdivision).
-- The Act lets a council assess it for the part of the year left; here it is the
-- whole-year figure scaled to the days remaining, written as its own assessment.
create or replace function assess_late_unit(p_year uuid, p_unit uuid, p_on date, p_actor text) returns bigint
language plpgsql as $$
declare
  y rating_years%rowtype;
  u rating_units%rowtype;
  full_cents bigint;
  share numeric;
  a_id uuid;
begin
  select * into y from rating_years where id = p_year;
  select * into u from rating_units where id = p_unit;
  if y.struck_on is null then raise exception 'rating year % has not been struck yet', y.label; end if;
  if exists (select 1 from assessments where rating_year_id = p_year and rating_unit_id = p_unit) then
    raise exception '% already has a rates assessment for %', u.assessment_no, y.label;
  end if;
  share := greatest(y.ends_on - greatest(p_on, y.starts_on) + 1, 0)::numeric / (y.ends_on - y.starts_on + 1);
  insert into assessments (rating_year_id, rating_unit_id, ratepayer_names, capital_value_cents, land_value_cents, category_code, total_cents, issued_on)
  select p_year, u.id, n.ratepayer_names, u.capital_value_cents, u.land_value_cents, u.category_code, 0, p_on
  from v_ratepayer_names n where n.rating_unit_id = u.id
  returning id into a_id;
  insert into assessment_lines (assessment_id, rate_type_id, basis_amount, factor, amount_cents)
  select a_id, c.rate_type_id, c.basis_amount, c.factor, round(c.amount_cents * share)::bigint
  from calc_rates(p_year, p_unit) c;
  select coalesce(sum(amount_cents), 0) into full_cents from assessment_lines where assessment_id = a_id;
  update assessments set total_cents = full_cents where id = a_id;
  insert into activity (actor, action, subject, detail) values (p_actor, 'assess-late-unit', u.assessment_no, 'part-year assessment of ' || full_cents || ' cents from ' || p_on);
  return full_cents;
end
$$;

-- Invoice one instalment for every assessed unit. Refused before the assessments
-- have gone out (s 48). The last instalment carries the rounding.
create or replace function issue_instalment(p_instalment uuid, p_on date, p_actor text) returns integer
language plpgsql as $$
declare
  i instalments%rowtype;
  y rating_years%rowtype;
  n_inst integer;
  n integer;
begin
  select * into i from instalments where id = p_instalment;
  select * into y from rating_years where id = i.rating_year_id;
  if i.no > 1 and exists (select 1 from instalments where rating_year_id = y.id and no < i.no and issued_on is null) then
    raise exception 'invoice the earlier instalments of % first', y.label;
  end if;
  if i.issued_on is not null then raise exception 'instalment % of % was invoiced on %', i.no, y.label, i.issued_on; end if;
  if y.struck_on is null then raise exception 'no rates assessments for % yet: strike the year first (the assessment goes before the invoice, s 48)', y.label; end if;
  if exists (select 1 from assessments a where a.rating_year_id = y.id and (a.issued_on is null or a.issued_on > p_on)) then
    raise exception 'an assessment for % goes out after %: the rates assessment must be delivered before the invoice (s 48)', y.label, p_on;
  end if;
  if p_on > i.due_on then raise exception 'invoice date % is after the due date %', p_on, i.due_on; end if;
  -- Instalments not yet invoiced, this one included. What is left of each
  -- assessment is split across them, so a part-year assessment made after the
  -- strike is collected in the instalments still to come.
  select count(*) into n_inst from instalments where rating_year_id = y.id and issued_on is null;

  insert into invoices (instalment_id, rating_unit_id, amount_cents, issued_on)
  select i.id, a.rating_unit_id,
         case when n_inst = 1 then a.total_cents - coalesce(done.cents, 0)
              else (a.total_cents - coalesce(done.cents, 0)) / n_inst end,
         p_on
  from assessments a
  left join (select v.rating_unit_id, sum(v.amount_cents) as cents
             from invoices v join instalments x on x.id = v.instalment_id
             where x.rating_year_id = y.id group by v.rating_unit_id) done on done.rating_unit_id = a.rating_unit_id
  where a.rating_year_id = y.id and a.total_cents > 0;
  get diagnostics n = row_count;

  insert into ledger (rating_unit_id, rating_year_id, instalment_id, kind, amount_cents, entry_on, ref, actor)
  select v.rating_unit_id, y.id, i.id, 'rates', v.amount_cents, p_on, y.label || ' instalment ' || i.no, p_actor
  from invoices v where v.instalment_id = i.id and v.amount_cents > 0;

  update instalments set issued_on = p_on where id = i.id;
  insert into activity (actor, action, subject, detail) values (p_actor, 'invoice', y.label || ' instalment ' || i.no, n || ' invoices dated ' || p_on || ', due ' || i.due_on);
  return n;
end
$$;

-- What each unit still owes on one instalment, applying credits to the oldest
-- debt first, counting only entries on or before p_on.
create or replace function unpaid_on_instalment(p_instalment uuid, p_on date)
returns table (rating_unit_id uuid, unpaid_cents bigint)
language sql stable as $$
  with inst as (select * from instalments where id = p_instalment),
  inv as (select v.rating_unit_id, v.amount_cents from invoices v where v.instalment_id = p_instalment),
  upto as (
    select l.rating_unit_id, sum(l.amount_cents) as through_cents
    from v_ledger_due l, inst
    where l.amount_cents > 0 and l.entry_on <= p_on
      and (l.due_on < inst.due_on or l.instalment_id = inst.id)
    group by l.rating_unit_id
  ),
  paid as (
    select rating_unit_id, -sum(amount_cents) as paid from ledger where amount_cents < 0 and entry_on <= p_on group by rating_unit_id
  )
  select inv.rating_unit_id,
         least(greatest(coalesce(upto.through_cents, 0) - coalesce(paid.paid, 0), 0), inv.amount_cents)::bigint
  from inv
  left join upto on upto.rating_unit_id = inv.rating_unit_id
  left join paid on paid.rating_unit_id = inv.rating_unit_id
$$;

-- s 58(1)(a): a penalty of up to 10 percent on the part of an instalment unpaid
-- after its due date, added on the date the resolution set. Once per instalment.
create or replace function apply_instalment_penalties(p_instalment uuid, p_on date, p_actor text) returns integer
language plpgsql as $$
declare
  i instalments%rowtype;
  y rating_years%rowtype;
  n integer;
begin
  select * into i from instalments where id = p_instalment;
  select * into y from rating_years where id = i.rating_year_id;
  if y.penalty_resolution_ref is null then raise exception 'no penalty resolution for %: penalties need one (s 57)', y.label; end if;
  if i.penalty_on is null then raise exception 'instalment % of % has no penalty date', i.no, y.label; end if;
  if p_on < i.penalty_on then raise exception 'the penalty date for instalment % is %: not before it', i.no, i.penalty_on; end if;
  if i.penalties_applied_on is not null then raise exception 'penalties on instalment % were added on %', i.no, i.penalties_applied_on; end if;

  insert into ledger (rating_unit_id, rating_year_id, instalment_id, kind, penalty_type, amount_cents, entry_on, ref, note, actor)
  select u.rating_unit_id, y.id, i.id, 'penalty', 'instalment', round(u.unpaid_cents * i.penalty_pct / 100)::bigint, p_on,
         y.label || ' instalment ' || i.no || ' penalty', i.penalty_pct || '% of ' || u.unpaid_cents || ' cents unpaid at ' || i.due_on, p_actor
  from unpaid_on_instalment(i.id, i.due_on) u
  where round(u.unpaid_cents * i.penalty_pct / 100) > 0;
  get diagnostics n = row_count;
  update instalments set penalties_applied_on = p_on where id = i.id;
  insert into activity (actor, action, subject, detail) values (p_actor, 'penalties', y.label || ' instalment ' || i.no, n || ' penalties at ' || i.penalty_pct || '%');
  return n;
end
$$;

-- s 58(1)(b) and (c): up to 10 percent on rates from earlier years still unpaid
-- on the date set, and a further penalty six months later if still unpaid.
create or replace function apply_arrears_penalty(p_year uuid, p_type text, p_pct numeric, p_on date, p_actor text) returns integer
language plpgsql as $$
declare
  y rating_years%rowtype;
  n integer;
begin
  select * into y from rating_years where id = p_year;
  if p_type not in ('prior_year', 'further') then raise exception 'penalty type is prior_year or further'; end if;
  if p_pct > 10 or p_pct <= 0 then raise exception 'a penalty on unpaid rates is at most 10 percent (s 58): % refused', p_pct; end if;
  if y.penalty_resolution_ref is null then raise exception 'no penalty resolution for %: penalties need one (s 57)', y.label; end if;
  if p_type = 'prior_year' and p_on < greatest(y.starts_on, add_working_days(coalesce(y.resolution_on, y.starts_on), 5)) then
    raise exception 'the penalty on earlier years is added no earlier than % (the later of the year start and five working days after the resolution, s 58(1)(b))',
      greatest(y.starts_on, add_working_days(coalesce(y.resolution_on, y.starts_on), 5));
  end if;
  if p_type = 'further' and not exists (
       select 1 from ledger where rating_year_id = p_year and kind = 'penalty' and penalty_type = 'prior_year' and entry_on <= p_on - interval '6 months') then
    raise exception 'a further penalty comes at least six months after the penalty on earlier years (s 58(1)(c))';
  end if;

  with prior as (
    select rating_unit_id, sum(amount_cents) as prior_cents
    from v_ledger_due where amount_cents > 0 and due_on < y.starts_on and entry_on <= p_on group by rating_unit_id
  ), paid as (
    select rating_unit_id, -sum(amount_cents) as paid from ledger where amount_cents < 0 and entry_on <= p_on group by rating_unit_id
  ), unpaid as (
    select p.rating_unit_id, greatest(p.prior_cents - coalesce(c.paid, 0), 0) as cents
    from prior p left join paid c on c.rating_unit_id = p.rating_unit_id
  )
  insert into ledger (rating_unit_id, rating_year_id, kind, penalty_type, amount_cents, entry_on, ref, note, actor)
  select rating_unit_id, p_year, 'penalty', p_type, round(cents * p_pct / 100)::bigint, p_on,
         y.label || case when p_type = 'prior_year' then ' penalty on earlier years' else ' further penalty' end,
         p_pct || '% of ' || cents || ' cents unpaid from earlier years', p_actor
  from unpaid where round(cents * p_pct / 100) > 0;
  get diagnostics n = row_count;
  insert into activity (actor, action, subject, detail) values (p_actor, 'arrears-penalty', y.label, n || ' ' || p_type || ' penalties at ' || p_pct || '%');
  return n;
end
$$;

-- ---------------------------------------------------------------- access

do $$
declare t text;
begin
  foreach t in array array['settings', 'categories', 'rating_units', 'ratepayers', 'unit_ratepayers', 'mortgagees',
    'rating_years', 'rate_types', 'rate_differentials', 'instalments', 'assessments', 'assessment_lines', 'invoices',
    'ledger', 'relief_policies', 'relief_applications', 'rebate_applications', 'objections', 'arrears_actions', 'activity']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public', t);
  end loop;
end
$$;
