-- Demo data for council-rates-for-claude-code.
-- Ruaroa District Council, a fictional New Zealand district: 24 rating units
-- across five differential categories, the rates resolution for this year and the
-- year before, seven rate types, four instalments, the strike, two instalments
-- invoiced, payments, penalties, arrears, relief, rebates and an objection.
--
-- Deliberately messy, so the attention list has something to say:
--   a ratepayer in default since last year with a first mortgagee nobody has
--     notified yet, 140 days behind
--   a ratepayer 100 days behind who had a reminder and no final notice
--   a lifestyle block behind on both instalments with no step taken at all
--   penalties on instalment 2 due four days ago and not added
--   a sold property with no new owner on the rating information database
--   a new subdivision lot added after the strike with no rates assessment
--   a rural unit missed in the last general revaluation, its value over 3 years old
--   a hardship remission application 45 days old with no decision
--   a rates rebate approved 50 days ago and never claimed back
--   a rebate application received after the rating year it was for had ended
--   an objection to the rating information database open for 50 days
--   a ratepayer in credit after paying the whole year up front
--   a name withheld from the public copy of the database at the owner's request
--
-- Dates are relative to current_date. Every name, address and value is fictional.
-- Idempotent: a second run returns at once.

do $$
declare
  t date := current_date;
  y_prev uuid;
  y uuid;
  i1 uuid; i2 uuid; i3 uuid; i4 uuid;
  r record;
  u uuid;
  amt bigint;
begin
  if exists (select 1 from settings) then return; end if;

  insert into settings (council_name) values ('Ruaroa District Council');

  insert into categories (code, name, description) values
    ('RES', 'Residential', 'Land used for residential purposes in the urban rating area'),
    ('COM', 'Commercial', 'Land used for commercial purposes'),
    ('IND', 'Industrial', 'Land used for industrial purposes'),
    ('RUR', 'Rural', 'Rural land over 10 ha used for farming or forestry'),
    ('LIF', 'Lifestyle', 'Rural land under 10 ha used mainly for residential purposes');

  insert into relief_policies (code, name, kind, policy_ref, max_pct, description) values
    ('MFL', 'Remission of rates on Maori freehold land', 'remission', 'Policy under LGA 2002 s 108', 100, 'Unoccupied and unused Maori freehold land'),
    ('HARD', 'Remission for financial hardship', 'remission', 'Rates remission policy under LGA 2002 s 109', 50, 'A ratepayer who cannot pay because of hardship, one year at a time'),
    ('PEN', 'Remission of penalties', 'remission', 'Rates remission policy under LGA 2002 s 109', 100, 'Penalties remitted where the ratepayer pays the rest in full or keeps to an arrangement'),
    ('POST65', 'Postponement for ratepayers 65 and over', 'postponement', 'Rates postponement policy under LGA 2002 s 110', null, 'Rates postponed against the property until sale');

  -- ---------------------------------------------------------------- the roll
  create temp table seed_units (
    no text, vref text, address text, locality text, legal text, cat text, lv bigint, cv bigint, vdate date,
    area numeric, suips int, pct int, mfl boolean, w boolean, ww boolean, rf boolean, created date, owners text[]
  ) on commit drop;
  insert into seed_units values
    ('10010-001', '06210/101.00', '12 Kowhai Street', 'Ruaroa', 'Lot 12 DP 41022', 'RES', 31000000, 64000000, t - 500, 0.0712, 1, 100, false, true, true, true, t - 4000, array['Aroha Tane', 'Mike Tane']),
    ('10010-002', '06210/102.00', '14 Kowhai Street', 'Ruaroa', 'Lot 13 DP 41022', 'RES', 30000000, 59000000, t - 500, 0.0698, 1, 100, false, true, true, true, t - 4000, array['Grace Liu']),
    ('10010-003', '06210/103.00', '18 Kowhai Street (3 flats)', 'Ruaroa', 'Lot 15 DP 41022', 'RES', 42000000, 115000000, t - 500, 0.1012, 3, 100, false, true, true, true, t - 4000, array['Harbourside Rentals Limited']),
    ('10010-004', '06210/110.00', '22 Rata Road', 'Ruaroa', 'Lot 4 DP 50311', 'RES', 28000000, 52000000, t - 500, 0.0650, 1, 100, false, true, true, true, t - 4000, array['Peter Whitcombe', 'Ann Whitcombe']),
    ('10010-005', '06210/115.00', '5 Matai Lane', 'Ruaroa', 'Lot 2 DP 61877', 'RES', 35000000, 81000000, t - 500, 0.0802, 1, 100, false, true, true, true, t - 4000, array['Sarah Kemp']),
    ('10010-006', '06210/116.00', '9 Matai Lane', 'Ruaroa', 'Lot 4 DP 61877', 'RES', 26000000, 48000000, t - 500, 0.0590, 1, 100, false, true, true, true, t - 4000, array['Tom Ngata']),
    ('10010-007', '06210/121.00', '31 Rimu Terrace', 'Ruaroa', 'Lot 31 DP 38110', 'RES', 24000000, 45500000, t - 500, 0.0603, 1, 100, false, true, true, true, t - 4000, array['Dennis Hart']),
    ('10010-008', '06210/122.00', '33 Rimu Terrace', 'Ruaroa', 'Lot 32 DP 38110', 'RES', 25000000, 47000000, t - 500, 0.0611, 1, 100, false, true, true, true, t - 4000, array['Mere Paku']),
    ('10010-009', '06210/130.00', '40 Totara Avenue', 'Ruaroa', 'Lot 8 DP 47720', 'RES', 29000000, 61000000, t - 500, 0.0705, 1, 100, false, true, true, true, t - 4000, array['Jason Bell']),
    ('10010-010', '06210/131.00', '44 Totara Avenue', 'Ruaroa', 'Lot 9 DP 47720', 'RES', 30000000, 65000000, t - 500, 0.0711, 1, 100, false, true, true, true, t - 4000, array['Estate of Joan Price']),
    ('10010-011', '06210/140.00', '2 Nikau Place', 'Ruaroa', 'Lot 1 DP 55102', 'RES', 33000000, 70000000, t - 500, 0.0750, 1, 100, false, true, true, true, t - 4000, array['Wiremu Rangi', 'Hana Rangi']),
    ('10010-012', '06210/141.00', '6 Nikau Place', 'Ruaroa', 'Lot 3 DP 55102', 'RES', 27000000, 53000000, t - 500, 0.0688, 1, 100, false, true, true, true, t - 4000, array['Brooke Adams']),
    ('20020-001', '06220/001.00', '1 Main Street', 'Ruaroa', 'Pt Section 1 Town of Ruaroa', 'COM', 52000000, 140000000, t - 500, 0.0910, 1, 100, false, true, true, true, t - 4000, array['Main Street Holdings Limited']),
    ('20020-002', '06220/015.00', '15 Main Street', 'Ruaroa', 'Section 15 Town of Ruaroa', 'COM', 61000000, 220000000, t - 500, 0.1015, 1, 100, false, true, true, true, t - 4000, array['Bayview Property Trust']),
    ('20020-003', '06220/070.00', '7 Mill Road', 'Ruaroa', 'Lot 1 DP 70221', 'IND', 90000000, 310000000, t - 500, 1.8200, 1, 100, false, true, true, false, t - 4000, array['Southern Timber Processing Limited']),
    ('30030-001', '06240/182.00', '1820 Kahu Valley Road', 'Kahu Valley', 'Sections 4 and 5 Block II Kahu SD', 'RUR', 420000000, 510000000, t - 500, 210.0000, 1, 100, false, false, false, false, t - 4000, array['Kahu Valley Farms Limited']),
    ('30030-002', '06240/455.00', '455 Ridge Road', 'Kahu Valley', 'Lot 2 DP 30119', 'RUR', 190000000, 260000000, t - 500, 85.0000, 1, 100, false, false, false, false, t - 4000, array['McKenzie Family Trust']),
    ('30030-003', '06240/900.00', 'Kahu 2B2 Block, Kahu Valley Road', 'Kahu Valley', 'Kahu 2B2 Block, Maori Land Court', 'RUR', 90000000, 90000000, t - 500, 120.0000, 1, 100, true, false, false, false, t - 4000, array['Kahu 2B2 Ahu Whenua Trust']),
    ('30030-004', '06240/077.00', '77 Totara Flat Road', 'Totara Flat', 'Lot 1 DP 22018', 'RUR', 110000000, 160000000, t - 1300, 40.0000, 1, 100, false, false, false, false, t - 4000, array['Brian Oakes', 'Lyn Oakes']),
    ('40040-001', '06250/012.00', '12 Kahu Bay Road', 'Kahu Bay', 'Lot 3 DP 49001', 'LIF', 60000000, 130000000, t - 500, 4.0000, 1, 100, false, false, false, true, t - 4000, array['Nicola Fraser']),
    ('40040-002', '06250/030.00', '30 Kahu Bay Road', 'Kahu Bay', 'Lot 7 DP 49001', 'LIF', 52000000, 105000000, t - 500, 2.5000, 1, 100, false, false, false, true, t - 4000, array['James Whitfield']),
    ('50050-001', '06210/300.00', 'Ruaroa School, 1 School Road', 'Ruaroa', 'Section 30 Town of Ruaroa', 'RES', 80000000, 420000000, t - 500, 2.1000, 1, 0, false, true, true, false, t - 4000, array['Ministry of Education']),
    ('50050-002', '06210/310.00', 'Ruaroa Bowling Club, 3 Park Road', 'Ruaroa', 'Section 31 Town of Ruaroa', 'COM', 30000000, 52000000, t - 500, 0.6000, 1, 50, false, true, false, false, t - 4000, array['Ruaroa Bowling Club Incorporated']),
    ('10010-013', '06210/132.00', '50 Totara Avenue', 'Ruaroa', 'Lot 4 DP 612345', 'RES', 25000000, 25000000, t - 25, 0.0601, 1, 100, false, true, true, true, t - 30, array['Kahu Developments Limited']);

  insert into rating_units (assessment_no, valuation_ref, address, locality, legal_description, category_code, land_value_cents, capital_value_cents,
                            valuation_date, area_ha, suips, rateable_pct, maori_freehold, water_connected, wastewater_connected, refuse_service, created_on)
  select no, vref, address, locality, legal, cat, lv, cv, vdate, area, suips, pct, mfl, w, ww, rf, created from seed_units;

  insert into ratepayers (name, postal_address, email)
  select distinct o, 'c/o ' || s.address || ', ' || s.locality, lower(regexp_replace(o, '[^A-Za-z]+', '.', 'g')) || '@example.nz'
  from seed_units s, unnest(s.owners) o;
  update ratepayers set withhold_name = true, withhold_requested_on = t - 210 where name = 'Sarah Kemp';
  update ratepayers set postal_address = 'c/o Ngata Whanau, PO Box 12, Ruaroa' where name = 'Tom Ngata';

  insert into unit_ratepayers (rating_unit_id, ratepayer_id, from_on, until_on)
  select ru.id, rp.id, t - 3000, case when o = 'Estate of Joan Price' then t - 20 end
  from seed_units s join rating_units ru on ru.assessment_no = s.no, unnest(s.owners) o join ratepayers rp on rp.name = o;

  insert into mortgagees (rating_unit_id, lender, registered_on)
  select id, 'Kiwi Home Loans Limited', t - 2900 from rating_units where assessment_no = '10010-007'
  union all select id, 'Southern Bank', t - 1800 from rating_units where assessment_no = '10010-009'
  union all select id, 'Rural Lending Co', t - 2500 from rating_units where assessment_no = '30030-002';

  -- ---------------------------------------------------------------- the years
  insert into rating_years (label, starts_on, ends_on, resolution_on, resolution_ref, penalty_resolution_ref, penalty_resolution_on, struck_on)
  values (to_char(t - 505, 'YYYY') || '/' || to_char(t - 505 + 365, 'YY'), t - 505, t - 141, t - 535, 'Council resolution CO/' || to_char(t - 535, 'YYYY') || '/31', 'Council resolution CO/' || to_char(t - 535, 'YYYY') || '/32', t - 535, t - 525)
  returning id into y_prev;

  insert into rating_years (label, starts_on, ends_on, resolution_on, resolution_ref, penalty_resolution_ref, penalty_resolution_on)
  values (to_char(t - 140, 'YYYY') || '/' || to_char(t - 140 + 365, 'YY'), t - 140, t + 224, t - 170, 'Council resolution CO/' || to_char(t - 170, 'YYYY') || '/44', 'Council resolution CO/' || to_char(t - 170, 'YYYY') || '/45', t - 170)
  returning id into y;

  insert into rate_types (rating_year_id, code, name, kind, basis, rate_per_dollar, fixed_cents, service, categories, excluded_from_cap, purpose) values
    (y, 'GEN', 'General rate', 'general', 'capital_value', 0.0021, null, null, null, false, 'Funds activities of general benefit to the district'),
    (y, 'UAGC', 'Uniform annual general charge', 'uagc', 'per_suip', null, 48000, null, null, false, 'Governance, libraries, parks and halls'),
    (y, 'ROAD', 'Rural roading rate', 'targeted', 'land_value', 0.0003, null, null, array['RUR', 'LIF'], false, 'Rural road maintenance'),
    (y, 'WATER', 'Water supply rate', 'targeted', 'per_connection', null, 72000, 'water', null, true, 'Ruaroa water supply, per connection'),
    (y, 'WW', 'Wastewater rate', 'targeted', 'per_suip', null, 86000, 'wastewater', null, true, 'Ruaroa wastewater scheme, per part connected'),
    (y, 'REFUSE', 'Kerbside collection rate', 'targeted', 'per_unit', null, 31000, 'refuse', null, false, 'Weekly rubbish and fortnightly recycling'),
    (y, 'TOWN', 'Town centre promotion rate', 'targeted', 'capital_value', 0.0008, null, null, array['COM'], false, 'Main Street promotion and events');

  insert into rate_differentials (rate_type_id, category_code, factor)
  select rt.id, d.cat, d.f from rate_types rt,
    (values ('RES', 1.0), ('COM', 2.2), ('IND', 2.0), ('RUR', 0.55), ('LIF', 0.85)) d(cat, f)
  where rt.rating_year_id = y and rt.code = 'GEN';

  insert into instalments (rating_year_id, no, due_on, penalty_on, penalty_pct) values
    (y, 1, t - 100, t - 95, 10), (y, 2, t - 9, t - 4, 10), (y, 3, t + 82, t + 87, 10), (y, 4, t + 173, t + 178, 10);
  select id into i1 from instalments where rating_year_id = y and no = 1;
  select id into i2 from instalments where rating_year_id = y and no = 2;

  -- Arrears from last year, carried in from the old system
  insert into ledger (rating_unit_id, rating_year_id, kind, amount_cents, entry_on, ref, note, actor)
  select ru.id, y_prev, 'arrears_brought_forward', a.cents, t - 141, 'Opening balance', 'Unpaid ' || to_char(t - 505, 'YYYY') || '/' || to_char(t - 140, 'YY') || ' rates carried in from the previous system', 'Data migration'
  from rating_units ru join (values ('10010-007', 412600), ('10010-012', 96000)) a(no, cents) on a.no = ru.assessment_no;

  -- s 58(1)(b): 10 percent on earlier years, the first day of the year
  perform apply_arrears_penalty(y, 'prior_year', 10, t - 139, 'Rates team');

  -- The strike, then two instalments
  perform strike_year(y, t - 160, 'Rates team');
  perform issue_instalment(i1, t - 130, 'Rates team');
  perform issue_instalment(i2, t - 40, 'Rates team');

  -- Maori freehold remission approved before the first invoice: the whole year
  select a.total_cents, a.rating_unit_id into amt, u from assessments a join rating_units ru on ru.id = a.rating_unit_id
  where a.rating_year_id = y and ru.assessment_no = '30030-003';
  insert into relief_applications (rating_unit_id, policy_code, rating_year_id, received_on, status, amount_cents, decided_on, decided_by, reason)
  values (u, 'MFL', y, t - 175, 'approved', amt, t - 150, 'Rates manager', 'Block unoccupied and unused; full remission under the Maori freehold land policy');
  insert into ledger (rating_unit_id, rating_year_id, kind, amount_cents, entry_on, ref, note, actor)
  values (u, y, 'remission', -amt, t - 150, 'MFL remission', 'Full remission, Maori freehold land policy', 'Rates manager');

  -- Payments. Most pay each instalment a few days early.
  for r in select ru.id, ru.assessment_no from rating_units ru
           where ru.assessment_no in ('10010-001', '10010-002', '10010-003', '10010-004', '10010-005', '10010-006', '10010-008', '10010-010',
                                      '20020-001', '20020-002', '20020-003', '30030-001', '30030-002', '30030-004', '40040-001', '50050-001', '50050-002')
  loop
    select amount_cents into amt from invoices where instalment_id = i1 and rating_unit_id = r.id;
    insert into ledger (rating_unit_id, rating_year_id, instalment_id, kind, amount_cents, entry_on, ref, actor)
    values (r.id, y, i1, 'payment', -amt, t - 104, 'Direct credit', 'Bank file');
    if r.assessment_no not in ('10010-008', '10010-010', '20020-002', '30030-001', '30030-002') then
      select amount_cents into amt from invoices where instalment_id = i2 and rating_unit_id = r.id;
      insert into ledger (rating_unit_id, rating_year_id, instalment_id, kind, amount_cents, entry_on, ref, actor)
      values (r.id, y, i2, 'payment', -amt, t - 12, 'Direct credit', 'Bank file');
    end if;
  end loop;

  -- The Rangis pay the whole year up front, plus 50 dollars too much
  select a.total_cents, a.rating_unit_id into amt, u from assessments a join rating_units ru on ru.id = a.rating_unit_id
  where a.rating_year_id = y and ru.assessment_no = '10010-011';
  insert into ledger (rating_unit_id, rating_year_id, kind, amount_cents, entry_on, ref, note, actor)
  values (u, y, 'payment', -(amt + 5000), t - 125, 'Internet banking', 'Whole year paid in one payment', 'Bank file');

  -- Brooke Adams pays fortnightly under an arrangement
  select id into u from rating_units where assessment_no = '10010-012';
  insert into ledger (rating_unit_id, rating_year_id, kind, amount_cents, entry_on, ref, actor)
  select u, y, 'payment', -15000, t - 120 + g * 14, 'Arrangement payment', 'Bank file' from generate_series(0, 8) g;
  insert into arrears_actions (rating_unit_id, step, taken_on, actor, note)
  values (u, 'arrangement', t - 122, 'Rates officer', 'Pays 150 dollars a fortnight by automatic payment until the account is clear');

  -- James Whitfield pays instalment 1 late and leaves the penalty
  select id into u from rating_units where assessment_no = '40040-002';
  select amount_cents into amt from invoices where instalment_id = i1 and rating_unit_id = u;
  -- (paid after the penalty date, so the penalty below still applies)

  -- s 58(1)(a): 10 percent on instalment 1 left unpaid, added on its penalty date
  perform apply_instalment_penalties(i1, t - 95, 'Rates team');
  insert into ledger (rating_unit_id, rating_year_id, instalment_id, kind, amount_cents, entry_on, ref, actor)
  values (u, y, i1, 'payment', -amt, t - 60, 'Counter payment', 'Customer services');

  -- Arrears steps taken so far
  insert into arrears_actions (rating_unit_id, step, taken_on, actor, note)
  select id, 'reminder', t - 125, 'Rates officer', 'Reminder for last year''s arrears' from rating_units where assessment_no = '10010-007'
  union all select id, 'final_notice', t - 95, 'Rates officer', 'Final notice: last year''s rates, penalty and instalment 1' from rating_units where assessment_no = '10010-007'
  union all select id, 'note', t - 70, 'Rates officer', 'Phoned. No answer, voicemail left.' from rating_units where assessment_no = '10010-007'
  union all select id, 'reminder', t - 80, 'Rates officer', 'Reminder for instalment 1' from rating_units where assessment_no = '10010-009';

  -- Relief, rebates and an objection
  insert into relief_applications (rating_unit_id, policy_code, rating_year_id, received_on, reason)
  select id, 'HARD', y, t - 45, 'Drought: stock sold early, income down by half this season' from rating_units where assessment_no = '30030-002';

  select a.total_cents, a.rating_unit_id into amt, u from assessments a join rating_units ru on ru.id = a.rating_unit_id
  where a.rating_year_id = y and ru.assessment_no = '10010-006';
  insert into rebate_applications (rating_unit_id, applicant, rating_year_id, received_on, household_income_cents, dependants, rates_payable_cents, rebate_cents, status, decided_on, note)
  values (u, 'Tom Ngata', y, t - 60, 2400000, 0, amt, 70000, 'approved', t - 50, 'Demo rebate amount: work out the real one on the current Department of Internal Affairs form');
  insert into ledger (rating_unit_id, rating_year_id, kind, amount_cents, entry_on, ref, note, actor)
  values (u, y, 'rebate', -70000, t - 50, 'Rates rebate', 'Rates Rebate Act 1973', 'Rates officer');

  insert into rebate_applications (rating_unit_id, applicant, rating_year_id, received_on, household_income_cents, dependants, status, note)
  select id, 'Mere Paku', y_prev, t - 120, 2650000, 1, 'received', 'Application for last year, posted in after that year ended'
  from rating_units where assessment_no = '10010-008';

  insert into objections (rating_unit_id, objector, received_on, grounds)
  select id, 'Bayview Property Trust', t - 50, 'Upstairs is two flats lived in, not commercial space: the category and the number of separately used parts are wrong'
  from rating_units where assessment_no = '20020-002';

  insert into activity (actor, action, subject, detail) values
    ('Data migration', 'import', 'opening balances', 'Arrears from the previous system'),
    ('Rates officer', 'withhold', 'Sarah Kemp', 'Written request under s 28C: name and postal address withheld');
end
$$;
