#!/usr/bin/env node
// council-rates-for-claude-code: the one CLI. Claude Code slash commands call
// this; so can you.
//
//   node scripts/rates.mjs <command> [args] [--flags] [--json]
//   npm run rates -- <command> ...
//
// Run with no arguments (or `help`) for the command list.
//
// This system holds a council's rating units, values, ratepayers, the rates set
// each year, the strike, instalment invoices, the rates ledger, penalties,
// arrears steps, remissions, postponements, rebates and objections. It records
// payments the bank has already received; it never takes one. The valuations
// come from the council's valuation service provider; it never makes one.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick, yesNo } from './lib/csv.mjs';
import { table, money, price, isoDate, short, truncate, heading } from './lib/format.mjs';

// ---------------------------------------------------------------- arguments

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'open', 'apply', 'confirm', 'dry-run', 'off', 'arrears', 'force']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { flags.help = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name; let value;
      if (eq > -1) { name = a.slice(2, eq); value = a.slice(eq + 1); }
      else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else args.push(a);
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // New Zealand exports write DD/MM/YYYY.
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
}

function parseMoney(v, what = 'amount') {
  if (v === undefined || v === null || v === '' || v === true) throw new CliError(`Give the ${what} in dollars, for example 250 or 1250.50.`);
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) throw new CliError(`"${v}" is not an amount.`);
  return Math.round(n * 100);
}
const optMoney = (v) => (v === undefined || v === true || v === '' ? null : parseMoney(v));

function actorOf(flags) {
  const a = str(flags.actor) || process.env.RATES_ACTOR || '';
  if (!a.trim()) throw new CliError('Name who is doing this: --actor="Your name" (or set RATES_ACTOR). Every change is recorded against a person.');
  return a.trim();
}

const nz = (cents) => money(cents, 'NZD');
const nzc = (cents) => price(cents, 'NZD');

// ---------------------------------------------------------------- lookups

const RESOLVERS = {
  unit: {
    from: 'rating_units c left join v_ratepayer_names n on n.rating_unit_id = c.id',
    cols: 'c.*, n.ratepayer_names',
    exact: 'lower(c.assessment_no) = lower($1) or lower(coalesce(c.valuation_ref, \'\')) = lower($1) or lower(c.address) = lower($1)',
    fuzzy: 'c.assessment_no ilike $1 or c.address ilike $1 or c.legal_description ilike $1 or n.ratepayer_names ilike $1',
    label: (r) => `${r.assessment_no}  ${r.address}, ${r.locality || ''} (${r.ratepayer_names || 'no ratepayer'})`,
    listing: 'units',
  },
  ratepayer: {
    from: 'ratepayers c',
    cols: 'c.*',
    exact: 'lower(c.name) = lower($1) or lower(coalesce(c.email, \'\')) = lower($1) or lower(coalesce(c.external_ref, \'\')) = lower($1)',
    fuzzy: 'c.name ilike $1 or c.email ilike $1',
    label: (r) => `${r.name}${r.email ? ` <${r.email}>` : ''}`,
    listing: 'ratepayers',
  },
};

async function resolve(db, kind, ref) {
  const R = RESOLVERS[kind];
  const q = str(ref).trim();
  if (!q) throw new CliError(`Which ${kind}? Give an assessment number, address or name. List them with: rates ${R.listing}`);
  if (/^[0-9a-f-]{8,36}$/i.test(q)) {
    const byId = await db.query(`select ${R.cols} from ${R.from} where c.id::text like $1`, [`${q.toLowerCase()}%`]);
    if (byId.length === 1) return byId[0];
  }
  let rows = await db.query(`select ${R.cols} from ${R.from} where ${R.exact}`, [q]);
  if (!rows.length) rows = await db.query(`select ${R.cols} from ${R.from} where ${R.fuzzy}`, [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No ${kind} matches "${q}". List them with: rates ${R.listing}`);
  throw new CliError(`"${q}" matches ${rows.length} ${kind} records. Be more specific:\n${rows.slice(0, 15).map((r) => '  ' + R.label(r)).join('\n')}`);
}

async function yearOf(db, flags) {
  const label = str(flags.year);
  const rows = label
    ? await db.query('select * from rating_years where label = $1 or label like $2 order by starts_on desc', [label, `${label}%`])
    : await db.query('select * from rating_years where starts_on <= current_date order by starts_on desc limit 1');
  if (!rows.length) throw new CliError(label ? `No rating year "${label}". See: rates years` : 'No rating year set up yet.');
  return rows[0];
}

async function instalmentOf(db, year, n) {
  if (!n || n === true) throw new CliError('Which instalment? --instalment=1');
  const rows = await db.query('select * from instalments where rating_year_id = $1 and no = $2', [year.id, Number(n)]);
  if (!rows.length) throw new CliError(`${year.label} has no instalment ${n}. See: rates instalments`);
  return rows[0];
}

async function logActivity(db, actor, action, subject, detail) {
  await db.query('insert into activity (actor, action, subject, detail) values ($1, $2, $3, $4)', [actor, action, subject, detail]);
}

// Postgres errors raised by the rules in the database read as plain refusals.
async function tx(db, fn) {
  await db.exec('BEGIN');
  try {
    const out = await fn();
    await db.exec('COMMIT');
    return out;
  } catch (e) {
    await db.exec('ROLLBACK');
    if (e instanceof CliError) throw e;
    throw new CliError(`Refused: ${String(e.message || e).split('\n')[0]}`);
  }
}

// ---------------------------------------------------------------- read commands

async function cmdUnits(db, { flags }) {
  const where = ["c.status = 'active'"];
  const params = [];
  if (flags.category) { params.push(String(flags.category).toUpperCase()); where.push(`c.category_code = $${params.length}`); }
  if (flags.locality) { params.push(`%${flags.locality}%`); where.push(`c.locality ilike $${params.length}`); }
  const rows = await db.query(`
    select c.id, c.assessment_no, c.address, c.locality, c.category_code, c.capital_value_cents, c.land_value_cents, c.suips,
           c.rateable_pct, n.ratepayer_names, b.balance_cents::bigint as balance_cents, b.overdue_cents::bigint as overdue_cents, b.days_overdue,
           (select a.total_cents from assessments a join rating_years y on y.id = a.rating_year_id where a.rating_unit_id = c.id order by y.starts_on desc limit 1) as rates_cents
    from rating_units c
    left join v_ratepayer_names n on n.rating_unit_id = c.id
    left join v_unit_balance b on b.rating_unit_id = c.id
    where ${where.join(' and ')} ${flags.arrears ? 'and b.overdue_cents > 0' : ''}
    order by c.assessment_no`, params);
  return {
    data: rows,
    text: () => heading(`Rating units (${rows.length})`) + '\n' + table(rows, [
      { key: 'assessment_no', label: 'Assessment' },
      { key: 'address', label: 'Address', width: 32 },
      { key: 'category_code', label: 'Cat' },
      { key: 'capital_value_cents', label: 'Capital value', align: 'right', format: nz },
      { key: 'ratepayer_names', label: 'Ratepayer', width: 28, format: (v) => v || 'NONE ON FILE' },
      { key: 'rates_cents', label: 'Rates this year', align: 'right', format: (v) => (v == null ? 'not assessed' : nzc(v)) },
      { key: 'balance_cents', label: 'Balance', align: 'right', format: nzc },
    ]),
  };
}

async function cmdUnit(db, { args }) {
  const u = await resolve(db, 'unit', args.join(' '));
  const owners = await db.query(`select r.name, r.postal_address, r.email, r.withhold_name, ur.role, ur.from_on, ur.until_on
    from unit_ratepayers ur join ratepayers r on r.id = ur.ratepayer_id where ur.rating_unit_id = $1 order by ur.until_on nulls first, ur.from_on`, [u.id]);
  const balance = (await db.query('select balance_cents::bigint as balance_cents, overdue_cents::bigint as overdue_cents, days_overdue, oldest_unpaid_due from v_unit_balance where rating_unit_id = $1', [u.id]))[0];
  const assessments = await db.query(`select y.label, a.total_cents, a.issued_on, a.capital_value_cents, a.category_code
    from assessments a join rating_years y on y.id = a.rating_year_id where a.rating_unit_id = $1 order by y.starts_on desc`, [u.id]);
  const lines = await db.query(`select rt.code, rt.name, l.basis_amount, l.factor, l.amount_cents
    from assessment_lines l join assessments a on a.id = l.assessment_id join rate_types rt on rt.id = l.rate_type_id
    join rating_years y on y.id = a.rating_year_id where a.rating_unit_id = $1 and y.id = (select a2.rating_year_id from assessments a2 join rating_years y2 on y2.id = a2.rating_year_id where a2.rating_unit_id = $1 order by y2.starts_on desc limit 1)
    order by l.amount_cents desc`, [u.id]);
  const ledger = await db.query(`select l.entry_on, l.kind, l.penalty_type, l.amount_cents, l.ref, l.note, l.actor from ledger l where l.rating_unit_id = $1 order by l.entry_on, l.created_at`, [u.id]);
  const steps = await db.query('select step, taken_on, actor, note from arrears_actions where rating_unit_id = $1 order by taken_on', [u.id]);
  const mortgagees = await db.query('select lender, registered_on from mortgagees where rating_unit_id = $1', [u.id]);
  const arrears = (await db.query('select next_step, mortgagee_from from v_arrears where rating_unit_id = $1', [u.id]))[0] || null;
  return {
    data: { unit: u, ratepayers: owners, balance, assessments, lines, ledger, steps, mortgagees, arrears },
    text: () => [
      heading(`${u.assessment_no}  ${u.address}, ${u.locality || ''}`),
      `  Legal: ${u.legal_description || '-'}   Valuation ${u.valuation_ref || '-'} at ${isoDate(u.valuation_date) || 'no date'}`,
      `  Category ${u.category_code}   CV ${nz(u.capital_value_cents)}   LV ${nz(u.land_value_cents)}   ${u.suips} part(s)   ${u.rateable_pct}% rateable${u.maori_freehold ? '   Maori freehold land' : ''}`,
      `  Services: ${[u.water_connected && 'water', u.wastewater_connected && 'wastewater', u.refuse_service && 'kerbside'].filter(Boolean).join(', ') || 'none'}`,
      `  Ratepayer: ${u.ratepayer_names || 'NONE ON FILE'}${mortgagees.length ? `   Mortgagee: ${mortgagees.map((m) => m.lender).join(', ')}` : ''}`,
      `  Balance ${nzc(balance?.balance_cents)}   Overdue ${nzc(balance?.overdue_cents)}${num(balance?.days_overdue) ? ` (${balance.days_overdue} days)` : ''}${arrears ? `   Next: ${arrears.next_step}` : ''}`,
      '', '  This year\'s rates', table(lines, [
        { key: 'code', label: 'Rate' }, { key: 'name', label: 'Name', width: 30 },
        { key: 'basis_amount', label: 'Basis', align: 'right', format: (v) => Number(v).toLocaleString('en-NZ') },
        { key: 'factor', label: 'Factor', align: 'right' },
        { key: 'amount_cents', label: 'Amount', align: 'right', format: nzc },
      ]),
      '', '  Ledger', table(ledger, [
        { key: 'entry_on', label: 'Date', format: isoDate }, { key: 'kind', label: 'Entry', format: (v, r) => (r.penalty_type ? `penalty (${r.penalty_type})` : v) },
        { key: 'amount_cents', label: 'Amount', align: 'right', format: nzc }, { key: 'ref', label: 'Reference', width: 34 },
      ]),
      steps.length ? '\n  Arrears steps\n' + table(steps, [{ key: 'taken_on', label: 'Date', format: isoDate }, { key: 'step', label: 'Step' }, { key: 'actor', label: 'By' }, { key: 'note', label: 'Note', width: 50 }]) : '',
    ].join('\n'),
  };
}

async function cmdRatepayers(db) {
  const rows = await db.query(`select r.id, r.name, r.email, r.withhold_name,
      string_agg(u.assessment_no, ', ' order by u.assessment_no) filter (where ur.until_on is null) as units
    from ratepayers r left join unit_ratepayers ur on ur.ratepayer_id = r.id left join rating_units u on u.id = ur.rating_unit_id
    group by r.id order by r.name`);
  return { data: rows, text: () => heading(`Ratepayers (${rows.length})`) + '\n' + table(rows, [
    { key: 'name', label: 'Name', width: 36 }, { key: 'units', label: 'Units', width: 30, format: (v) => v || '(none current)' },
    { key: 'withhold_name', label: 'Withheld', format: (v) => (v ? 'yes (s 28C)' : '') }, { key: 'email', label: 'Email', width: 34 },
  ]) };
}

async function cmdRatepayer(db, { args }) {
  const r = await resolve(db, 'ratepayer', args.join(' '));
  const units = await db.query(`select u.assessment_no, u.address, ur.role, ur.from_on, ur.until_on, b.balance_cents::bigint as balance_cents
    from unit_ratepayers ur join rating_units u on u.id = ur.rating_unit_id left join v_unit_balance b on b.rating_unit_id = u.id
    where ur.ratepayer_id = $1 order by ur.until_on nulls first`, [r.id]);
  return { data: { ratepayer: r, units }, text: () => heading(r.name) + `\n  ${r.postal_address || ''}  ${r.email || ''}${r.withhold_name ? '\n  Name and postal address withheld from the public database (s 28C)' : ''}\n` +
    table(units, [{ key: 'assessment_no', label: 'Assessment' }, { key: 'address', label: 'Address', width: 32 }, { key: 'from_on', label: 'From', format: isoDate }, { key: 'until_on', label: 'Until', format: isoDate }, { key: 'balance_cents', label: 'Balance', align: 'right', format: nzc }]) };
}

async function cmdYears(db) {
  const rows = await db.query(`select y.label, y.starts_on, y.ends_on, y.resolution_on, y.resolution_ref, y.penalty_resolution_ref, y.struck_on,
      (select count(*)::int from assessments a where a.rating_year_id = y.id) as assessments,
      (select coalesce(sum(total_cents), 0)::bigint from assessments a where a.rating_year_id = y.id) as assessed_cents
    from rating_years y order by y.starts_on desc`);
  return { data: rows, text: () => heading('Rating years') + '\n' + table(rows, [
    { key: 'label', label: 'Year' }, { key: 'starts_on', label: 'Starts', format: isoDate }, { key: 'ends_on', label: 'Ends', format: isoDate },
    { key: 'resolution_ref', label: 'Rates resolution', width: 30 }, { key: 'struck_on', label: 'Struck', format: (v) => isoDate(v) || 'not yet' },
    { key: 'assessments', label: 'Assessments', align: 'right' }, { key: 'assessed_cents', label: 'Assessed', align: 'right', format: nz },
  ]) };
}

async function cmdRates(db, { flags }) {
  const y = await yearOf(db, flags);
  const rows = await db.query(`select rt.code, rt.name, rt.kind, rt.basis, rt.rate_per_dollar, rt.fixed_cents, rt.service, rt.categories, rt.excluded_from_cap,
      (select string_agg(d.category_code || ' ' || d.factor, ', ' order by d.category_code) from rate_differentials d where d.rate_type_id = rt.id) as differentials,
      rt.purpose
    from rate_types rt where rt.rating_year_id = $1 order by rt.kind, rt.code`, [y.id]);
  return { data: { year: y, rate_types: rows }, text: () => heading(`Rates set for ${y.label} (${y.resolution_ref || 'no resolution'})`) + '\n' + table(rows, [
    { key: 'code', label: 'Code' }, { key: 'name', label: 'Rate', width: 30 }, { key: 'basis', label: 'Basis' },
    { key: 'rate_per_dollar', label: 'Rate / $ or charge', align: 'right', format: (v, r) => (v != null ? Number(v).toFixed(6) : nzc(r.fixed_cents)) },
    { key: 'categories', label: 'Applies to', format: (v, r) => [r.service ? `${r.service} users` : '', v ? v.join(', ') : 'all'].filter(Boolean).join(', ') },
    { key: 'differentials', label: 'Differentials', width: 40 },
  ]) };
}

async function cmdPreview(db, { args, flags }) {
  const u = await resolve(db, 'unit', args.join(' '));
  const y = await yearOf(db, flags);
  const rows = await db.query(`select c.code, rt.name, c.basis_amount, c.factor, c.amount_cents::bigint as amount_cents
    from calc_rates($1, $2) c join rate_types rt on rt.id = c.rate_type_id order by c.amount_cents desc`, [y.id, u.id]);
  const total = rows.reduce((a, r) => a + num(r.amount_cents), 0);
  return { data: { unit: u.assessment_no, year: y.label, lines: rows, total_cents: total }, text: () => heading(`${u.assessment_no} ${u.address}: ${y.label} rates if assessed today`) + '\n' + table(rows, [
    { key: 'code', label: 'Rate' }, { key: 'name', label: 'Name', width: 30 }, { key: 'basis_amount', label: 'Basis', align: 'right', format: (v) => Number(v).toLocaleString('en-NZ') },
    { key: 'factor', label: 'Factor', align: 'right' }, { key: 'amount_cents', label: 'Amount', align: 'right', format: nzc },
  ]) + `\n  Total ${nzc(total)}` };
}

async function revenue(db, y) {
  const struck = !!y.struck_on;
  const rows = struck
    ? await db.query(`select rt.code, rt.name, rt.kind, rt.basis, rt.service, rt.excluded_from_cap, count(*)::int as units, sum(l.amount_cents)::bigint as revenue_cents
        from assessment_lines l join assessments a on a.id = l.assessment_id join rate_types rt on rt.id = l.rate_type_id
        where a.rating_year_id = $1 group by rt.id order by sum(l.amount_cents) desc`, [y.id])
    : await db.query(`select rt.code, rt.name, rt.kind, rt.basis, rt.service, rt.excluded_from_cap, count(*)::int as units, sum(c.amount_cents)::bigint as revenue_cents
        from calc_rates($1) c join rate_types rt on rt.id = c.rate_type_id group by rt.id order by sum(c.amount_cents) desc`, [y.id]);
  const total = rows.reduce((a, r) => a + num(r.revenue_cents), 0);
  // s 21: UAGCs and targeted rates set on a uniform basis, except those solely for water supply or sewage disposal.
  const uniform = rows.filter((r) => (r.kind === 'uagc' || ['per_unit', 'per_suip', 'per_connection'].includes(r.basis)) && !r.excluded_from_cap);
  const uniformCents = uniform.reduce((a, r) => a + num(r.revenue_cents), 0);
  const share = total ? uniformCents / total : 0;
  return { struck, rows, total, uniformCents, share, uniformCodes: uniform.map((r) => r.code) };
}

async function cmdRevenue(db, { flags }) {
  const y = await yearOf(db, flags);
  const r = await revenue(db, y);
  return { data: { year: y.label, struck: r.struck, by_rate: r.rows, total_cents: r.total, uniform_cents: r.uniformCents, uniform_share: Math.round(r.share * 10000) / 100 },
    text: () => heading(`${y.label} rates revenue ${r.struck ? 'as struck' : '(preview: not struck yet)'}`) + '\n' + table(r.rows, [
      { key: 'code', label: 'Rate' }, { key: 'name', label: 'Name', width: 32 }, { key: 'units', label: 'Units', align: 'right' },
      { key: 'revenue_cents', label: 'Revenue', align: 'right', format: nz }, { key: 'revenue_cents', label: 'Share', align: 'right', format: (v) => `${((num(v) / r.total) * 100).toFixed(1)}%` },
    ]) + `\n  Total ${nz(r.total)}.  Uniform charges under s 21 (${r.uniformCodes.join(', ')}): ${nz(r.uniformCents)}, ${(r.share * 100).toFixed(1)}% of the 30% allowed.` };
}

async function cmdInstalments(db, { flags }) {
  const y = await yearOf(db, flags);
  const rows = await db.query(`select i.no, i.due_on, i.penalty_on, i.penalty_pct, i.issued_on, i.penalties_applied_on,
      (select coalesce(sum(amount_cents), 0)::bigint from invoices v where v.instalment_id = i.id) as invoiced_cents,
      (select coalesce(sum(u.unpaid_cents), 0)::bigint from unpaid_on_instalment(i.id, current_date) u) as unpaid_cents,
      (select count(*)::int from unpaid_on_instalment(i.id, current_date) u where u.unpaid_cents > 0) as units_unpaid
    from instalments i where i.rating_year_id = $1 order by i.no`, [y.id]);
  return { data: { year: y.label, instalments: rows }, text: () => heading(`${y.label} instalments`) + '\n' + table(rows, [
    { key: 'no', label: 'No' }, { key: 'due_on', label: 'Due', format: isoDate }, { key: 'penalty_on', label: 'Penalty date', format: isoDate },
    { key: 'penalty_pct', label: 'Penalty', align: 'right', format: (v) => `${Number(v)}%` }, { key: 'issued_on', label: 'Invoiced', format: (v) => isoDate(v) || 'not yet' },
    { key: 'invoiced_cents', label: 'Invoiced', align: 'right', format: nz }, { key: 'unpaid_cents', label: 'Unpaid now', align: 'right', format: nz },
    { key: 'units_unpaid', label: 'Units unpaid', align: 'right' }, { key: 'penalties_applied_on', label: 'Penalties added', format: (v, r) => isoDate(v) || (r.penalty_on && isoDate(r.penalty_on) < today() && r.issued_on ? 'DUE, NOT ADDED' : '') },
  ]) };
}

async function cmdArrears(db, { flags }) {
  const min = num(flags['min-days']);
  const rows = await db.query(`select assessment_no, address, ratepayer_names, overdue_cents::bigint as overdue_cents, balance_cents::bigint as balance_cents,
      days_overdue, oldest_unpaid_due, last_step, last_step_on, has_mortgagee, mortgagee_from, next_step
    from v_arrears where days_overdue >= $1 order by days_overdue desc, overdue_cents desc`, [min]);
  const total = rows.reduce((a, r) => a + num(r.overdue_cents), 0);
  return { data: rows, text: () => heading(`Rates in arrears: ${rows.length} units, ${nzc(total)} overdue`) + '\n' + table(rows, [
    { key: 'assessment_no', label: 'Assessment' }, { key: 'ratepayer_names', label: 'Ratepayer', width: 26, format: (v) => v || '(no ratepayer)' }, { key: 'overdue_cents', label: 'Overdue', align: 'right', format: nzc },
    { key: 'days_overdue', label: 'Days', align: 'right' }, { key: 'last_step', label: 'Last step', format: (v, r) => (v ? `${v} ${isoDate(r.last_step_on)}` : 'none') },
    { key: 'next_step', label: 'Next step', width: 46 },
  ]) };
}

async function cmdLedger(db, { args }) {
  const out = await cmdUnit(db, { args });
  return { data: out.data.ledger, text: () => heading(`Ledger ${out.data.unit.assessment_no}`) + '\n' + table(out.data.ledger, [
    { key: 'entry_on', label: 'Date', format: isoDate }, { key: 'kind', label: 'Entry', format: (v, r) => (r.penalty_type ? `penalty (${r.penalty_type})` : v) },
    { key: 'amount_cents', label: 'Amount', align: 'right', format: nzc }, { key: 'ref', label: 'Reference', width: 34 }, { key: 'actor', label: 'By' },
  ]) + `\n  Balance ${nzc(out.data.balance?.balance_cents)}` };
}

async function cmdRelief(db, { flags }) {
  const rows = await db.query(`select a.id, u.assessment_no, u.address, p.code as policy, p.kind, p.policy_ref, y.label as year, a.received_on, a.status, a.amount_cents, a.decided_on, a.decided_by, a.reason,
      case when a.status = 'received' then (select count(*)::int from generate_series(a.received_on + 1, current_date, interval '1 day') d where extract(isodow from d) < 6) end as working_days_waiting,
      s.remission_decision_days
    from relief_applications a join rating_units u on u.id = a.rating_unit_id join relief_policies p on p.code = a.policy_code join rating_years y on y.id = a.rating_year_id cross join settings s
    ${flags.open ? "where a.status = 'received'" : ''} order by a.received_on desc`);
  return { data: rows, text: () => heading('Remissions and postponements') + '\n' + table(rows, [
    { key: 'id', label: 'Id', format: short }, { key: 'assessment_no', label: 'Assessment' }, { key: 'policy', label: 'Policy' }, { key: 'received_on', label: 'Received', format: isoDate },
    { key: 'status', label: 'Status', format: (v, r) => (v === 'received' ? `waiting ${r.working_days_waiting} working days` : v) }, { key: 'amount_cents', label: 'Amount', align: 'right', format: (v) => (v == null ? '' : nzc(v)) },
    { key: 'reason', label: 'Reason', width: 46 },
  ]) };
}

async function cmdRebates(db, { flags }) {
  const rows = await db.query(`select a.id, u.assessment_no, a.applicant, y.label as year, y.starts_on, y.ends_on, a.received_on, a.status, a.rebate_cents, a.decided_on, a.claimed_on,
      (a.received_on < y.starts_on or a.received_on > y.ends_on) as outside_year, a.note
    from rebate_applications a join rating_units u on u.id = a.rating_unit_id join rating_years y on y.id = a.rating_year_id
    ${flags.open ? "where a.status in ('received', 'approved')" : ''} order by a.received_on desc`);
  return { data: rows, text: () => heading('Rates rebates') + '\n' + table(rows, [
    { key: 'id', label: 'Id', format: short }, { key: 'assessment_no', label: 'Assessment' }, { key: 'applicant', label: 'Applicant' }, { key: 'year', label: 'Year' },
    { key: 'received_on', label: 'Received', format: isoDate }, { key: 'status', label: 'Status', format: (v, r) => (r.outside_year && v === 'received' ? 'received AFTER that year' : v === 'approved' && !r.claimed_on ? 'approved, not claimed' : v) },
    { key: 'rebate_cents', label: 'Rebate', align: 'right', format: (v) => (v == null ? '' : nzc(v)) },
  ]) };
}

async function cmdObjections(db, { flags }) {
  const rows = await db.query(`select o.id, u.assessment_no, o.objector, o.received_on, o.grounds, o.status, o.decided_on, o.outcome, current_date - o.received_on as days_open
    from objections o join rating_units u on u.id = o.rating_unit_id ${flags.open ? "where o.status = 'open'" : ''} order by o.received_on desc`);
  return { data: rows, text: () => heading('Objections to the rating information database (s 29)') + '\n' + table(rows, [
    { key: 'id', label: 'Id', format: short }, { key: 'assessment_no', label: 'Assessment' }, { key: 'objector', label: 'Objector', width: 24 }, { key: 'received_on', label: 'Received', format: isoDate },
    { key: 'status', label: 'Status', format: (v, r) => (v === 'open' ? `open ${r.days_open} days` : v) }, { key: 'grounds', label: 'Grounds', width: 50 },
  ]) };
}

async function cmdRid(db, { args }) {
  const where = args.length ? 'where assessment_no = $1' : '';
  const params = [];
  if (args.length) params.push((await resolve(db, 'unit', args.join(' '))).assessment_no);
  const rows = await db.query(`select * from v_rid_public ${where} order by assessment_no`, params);
  return { data: rows, text: () => heading('Rating information database: public copy (s 27, s 28)') + '\n' + table(rows, [
    { key: 'assessment_no', label: 'Assessment' }, { key: 'address', label: 'Address', width: 32 }, { key: 'legal_description', label: 'Legal', width: 30 },
    { key: 'category_code', label: 'Cat' }, { key: 'capital_value_cents', label: 'CV', align: 'right', format: nz }, { key: 'ratepayers', label: 'Ratepayer', width: 34, format: (v) => v || '' },
  ]) };
}

async function cmdCalendar(db, { flags }) {
  const days = num(flags.days) || 60;
  const rows = await db.query(`
    select d.on_date, d.what from (
      select i.due_on as on_date, y.label || ' instalment ' || i.no || ' due' as what from instalments i join rating_years y on y.id = i.rating_year_id
      union all select i.penalty_on, y.label || ' instalment ' || i.no || ' penalty date (s 58(1)(a))' from instalments i join rating_years y on y.id = i.rating_year_id where i.penalties_applied_on is null
      union all select (i.due_on - 28), y.label || ' instalment ' || i.no || ': invoices should be out' from instalments i join rating_years y on y.id = i.rating_year_id where i.issued_on is null
      union all select y.ends_on, y.label || ' ends: last day for rebate applications for this year (Rates Rebate Act 1973 s 5)' from rating_years y
      union all select (a.mortgagee_from), a.assessment_no || ': the mortgagee can be asked to pay (s 62)' from v_arrears a where a.mortgagee_from is not null
      union all select (o.received_on + 60), u.assessment_no || ': objection open 60 days' from objections o join rating_units u on u.id = o.rating_unit_id where o.status = 'open'
    ) d where d.on_date between current_date - 7 and current_date + $1::int order by d.on_date`, [days]);
  return { data: rows, text: () => heading(`Rating calendar: the next ${days} days`) + '\n' + table(rows, [{ key: 'on_date', label: 'Date', format: isoDate }, { key: 'what', label: 'What', width: 90 }]) };
}

async function cmdHistory(db, { flags }) {
  const rows = await db.query('select at, actor, action, subject, detail from activity order by at desc limit $1', [num(flags.limit) || 30]);
  return { data: rows, text: () => heading('Activity') + '\n' + table(rows, [{ key: 'at', label: 'When', format: (v) => String(isoDate(v)) }, { key: 'actor', label: 'By' }, { key: 'action', label: 'Action' }, { key: 'subject', label: 'Subject', width: 30 }, { key: 'detail', label: 'Detail', width: 50 }]) };
}

// ---------------------------------------------------------------- compliance and attention

async function findings(db) {
  const out = [];
  const add = (severity, rule, subject, detail) => out.push({ severity, rule, subject, detail });
  const y = (await db.query('select * from rating_years where starts_on <= current_date order by starts_on desc limit 1'))[0];
  const s = (await db.query('select * from settings'))[0];

  if (y) {
    if (!y.resolution_on) add('breach', 'LGRA s 23', y.label, 'No rates resolution recorded for the year');
    else if (isoDate(y.resolution_on) > isoDate(y.starts_on)) add('warning', 'LGRA s 23', y.label, `Rates set on ${isoDate(y.resolution_on)}, after the year began on ${isoDate(y.starts_on)}`);
    const pens = await db.query("select count(*)::int as n from ledger where rating_year_id = $1 and kind = 'penalty'", [y.id]);
    if (pens[0].n && !y.penalty_resolution_ref) add('breach', 'LGRA s 57', y.label, 'Penalties added with no penalty resolution recorded');
    if (y.penalty_resolution_on && y.resolution_on && isoDate(y.penalty_resolution_on) > isoDate(y.resolution_on)) add('breach', 'LGRA s 57(2)(a)', y.label, 'Penalty resolution made after the rates were set');
    const r = await revenue(db, y);
    if (r.share > 0.3) add('breach', 'LGRA s 21', y.label, `Uniform charges are ${(r.share * 100).toFixed(1)}% of rates revenue: the limit is 30%`);
    else if (r.share > 0.27) add('warning', 'LGRA s 21', y.label, `Uniform charges are ${(r.share * 100).toFixed(1)}% of rates revenue, close to the 30% limit`);
    for (const i of await db.query('select * from instalments where rating_year_id = $1 and issued_on is not null and penalty_on < current_date and penalties_applied_on is null', [y.id]))
      add('action', 'LGRA s 58(1)(a)', `${y.label} instalment ${i.no}`, `Penalty date ${isoDate(i.penalty_on)} has passed and penalties are not added (rates penalties --instalment=${i.no} --apply)`);
    for (const u of await db.query(`select u.assessment_no, u.address from rating_units u where u.status = 'active' and not exists (select 1 from assessments a where a.rating_unit_id = u.id and a.rating_year_id = $1)`, [y.id]))
      add('action', 'LGRA s 44', u.assessment_no, `${u.address} is on the roll with no rates assessment for ${y.label} (rates assess-late ${u.assessment_no})`);
  }
  for (const u of await db.query("select u.assessment_no, u.address from rating_units u join v_ratepayer_names n on n.rating_unit_id = u.id where u.status = 'active' and n.ratepayer_count = 0"))
    add('breach', 'LGRA s 27', u.assessment_no, `${u.address} has no ratepayer on the rating information database`);
  for (const u of await db.query(`select assessment_no, address, valuation_date from rating_units where status = 'active' and (valuation_date is null or valuation_date < current_date - make_interval(years => $1))`, [s.valuation_max_age_years]))
    add('breach', 'Rating Valuations Act 1998 s 9', u.assessment_no, `Value dated ${isoDate(u.valuation_date) || 'never'}: over ${s.valuation_max_age_years} years old, missed in a general revaluation`);
  for (const o of await db.query("select o.objector, o.received_on, u.assessment_no from objections o join rating_units u on u.id = o.rating_unit_id where o.status = 'open' and o.received_on < current_date - 30"))
    add('action', 'LGRA s 29', o.assessment_no, `Objection from ${o.objector} open since ${isoDate(o.received_on)}`);
  for (const a of await db.query(`select a.id, u.assessment_no, a.received_on, p.code, (select count(*)::int from generate_series(a.received_on + 1, current_date, interval '1 day') d where extract(isodow from d) < 6) as wd
      from relief_applications a join rating_units u on u.id = a.rating_unit_id join relief_policies p on p.code = a.policy_code where a.status = 'received'`))
    if (a.wd > s.remission_decision_days) add('action', 'Council policy (LGA 2002 s 109)', a.assessment_no, `${a.code} application waiting ${a.wd} working days for a decision (policy: ${s.remission_decision_days})`);
  for (const r of await db.query(`select a.applicant, u.assessment_no, a.received_on, y.label from rebate_applications a join rating_years y on y.id = a.rating_year_id join rating_units u on u.id = a.rating_unit_id
      where a.status = 'received' and (a.received_on > y.ends_on or a.received_on < y.starts_on)`))
    add('breach', 'Rates Rebate Act 1973 s 5', r.assessment_no, `${r.applicant} applied on ${isoDate(r.received_on)} for ${r.label}, outside that rating year: decline it`);
  for (const r of await db.query(`select a.applicant, u.assessment_no, a.decided_on, a.rebate_cents from rebate_applications a join rating_units u on u.id = a.rating_unit_id where a.status = 'approved' and a.claimed_on is null`))
    add('action', 'Rates Rebate Act 1973', r.assessment_no, `Rebate of ${nzc(r.rebate_cents)} for ${r.applicant} approved ${isoDate(r.decided_on)}, not yet claimed from the Department of Internal Affairs`);
  for (const r of await db.query(`select u.assessment_no, r.name, r.withhold_requested_on from ratepayers r join unit_ratepayers ur on ur.ratepayer_id = r.id and ur.until_on is null join rating_units u on u.id = ur.rating_unit_id where r.withhold_requested_on is not null and not r.withhold_name`))
    add('breach', 'LGRA s 28C', r.assessment_no, `${r.name} asked on ${isoDate(r.withhold_requested_on)} to have their name withheld and it still shows`);
  for (const a of await db.query("select assessment_no, next_step, days_overdue from v_arrears where next_step not in ('watch', 'watch the arrangement') and next_step not like 'wait:%'"))
    add('action', 'Arrears ladder', a.assessment_no, `${a.days_overdue} days overdue: ${a.next_step}`);
  // Credit beyond what the rest of the year's instalments will use is an overpayment.
  for (const c of await db.query(`select b.assessment_no, (-b.balance_cents - coalesce(a.total_cents - (select coalesce(sum(v.amount_cents), 0) from invoices v join instalments i on i.id = v.instalment_id
        where v.rating_unit_id = b.rating_unit_id and i.rating_year_id = a.rating_year_id), 0))::bigint as over_cents
      from v_unit_balance b left join assessments a on a.rating_unit_id = b.rating_unit_id and a.rating_year_id = $1
      where b.balance_cents < 0`, [y?.id ?? null]))
    if (num(c.over_cents) > 0) add('watch', 'Overpaid', c.assessment_no, `Paid ${nzc(c.over_cents)} more than this year's rates: refund it or hold it for next year`);
  for (const l of await db.query(`select u.assessment_no, min(d.due_on) as oldest from v_ledger_due d join rating_units u on u.id = d.rating_unit_id
      join v_unit_balance b on b.rating_unit_id = d.rating_unit_id where d.amount_cents > 0 and b.oldest_unpaid_due = d.due_on and d.due_on < current_date - interval '5 years' group by u.assessment_no`))
    add('breach', 'LGRA s 65', l.assessment_no, `Unpaid rates due ${isoDate(l.oldest)}: recovery through the court must start within 6 years`);
  const order = { breach: 0, action: 1, warning: 2, watch: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || a.subject.localeCompare(b.subject));
}

async function cmdCompliance(db) {
  const rows = await findings(db);
  return { data: rows, text: () => heading(`Compliance: ${rows.filter((r) => r.severity === 'breach').length} breaches, ${rows.filter((r) => r.severity === 'action').length} actions due`) + '\n' +
    table(rows, [{ key: 'severity', label: 'Level' }, { key: 'rule', label: 'Rule', width: 28 }, { key: 'subject', label: 'Subject', width: 22 }, { key: 'detail', label: 'Finding', width: 90 }]) +
    '\n  A clean list is not legal advice. docs/compliance.md cites each rule.' };
}

async function cmdAttention(db) {
  const all = await findings(db);
  const rows = all.filter((f) => f.severity !== 'watch');
  return { data: rows, text: () => heading(`Needs attention (${rows.length})`) + '\n' + table(rows, [{ key: 'severity', label: 'Level' }, { key: 'subject', label: 'Subject', width: 22 }, { key: 'detail', label: 'What to do', width: 100 }]) };
}

// ---------------------------------------------------------------- write commands

async function cmdStrike(db, { flags }) {
  const y = await yearOf(db, flags);
  if (y.struck_on) throw new CliError(`${y.label} was struck on ${isoDate(y.struck_on)}. The strike runs once; a unit added since is assessed with: rates assess-late <unit>`);
  const r = await revenue(db, y);
  const units = (await db.query('select count(distinct rating_unit_id)::int as n from calc_rates($1)', [y.id]))[0].n;
  if (!flags.confirm) {
    return { data: { year: y.label, dry_run: true, units, total_cents: r.total, uniform_share: r.share, by_rate: r.rows }, text: () =>
      heading(`${y.label} strike: test run, nothing written`) + `\n  ${units} units would be assessed for ${nz(r.total)}. Uniform charges ${(r.share * 100).toFixed(1)}% (s 21 limit 30%).\n` +
      table(r.rows, [{ key: 'code', label: 'Rate' }, { key: 'name', label: 'Name', width: 32 }, { key: 'units', label: 'Units', align: 'right' }, { key: 'revenue_cents', label: 'Revenue', align: 'right', format: nz }]) +
      '\n  Run again with --confirm --actor="Name" to issue the rates assessments.' };
  }
  if (r.share > 0.3) throw new CliError(`Refused: uniform charges would be ${(r.share * 100).toFixed(1)}% of rates revenue, over the 30% limit in s 21.`);
  const actor = actorOf(flags);
  const on = parseDate(flags.on) || today();
  const n = await tx(db, async () => (await db.query('select strike_year($1, $2, $3) as n', [y.id, on, actor]))[0].n);
  return { data: { year: y.label, assessments: n, on, total_cents: r.total }, text: () => `  ${y.label} struck: ${n} rates assessments issued ${on}, ${nz(r.total)} in total.` };
}

async function cmdAssessLate(db, { args, flags }) {
  const u = await resolve(db, 'unit', args.join(' '));
  const y = await yearOf(db, flags);
  const actor = actorOf(flags);
  const on = parseDate(flags.on) || today();
  const cents = await tx(db, async () => num((await db.query('select assess_late_unit($1, $2, $3, $4) as c', [y.id, u.id, on, actor]))[0].c));
  return { data: { unit: u.assessment_no, year: y.label, total_cents: cents, on }, text: () => `  ${u.assessment_no} assessed for the rest of ${y.label}: ${nzc(cents)}, collected in the instalments still to be invoiced.` };
}

async function cmdInvoice(db, { flags }) {
  const y = await yearOf(db, flags);
  const i = await instalmentOf(db, y, flags.instalment);
  const actor = actorOf(flags);
  const on = parseDate(flags.on) || today();
  const n = await tx(db, async () => (await db.query('select issue_instalment($1, $2, $3) as n', [i.id, on, actor]))[0].n);
  const total = (await db.query('select coalesce(sum(amount_cents), 0)::bigint as c from invoices where instalment_id = $1', [i.id]))[0].c;
  return { data: { year: y.label, instalment: i.no, invoices: n, total_cents: total, due_on: i.due_on }, text: () => `  ${y.label} instalment ${i.no}: ${n} invoices dated ${on}, ${nz(total)}, due ${isoDate(i.due_on)}. Render them with: npm run docs -- rates-invoice` };
}

async function cmdPay(db, { args, flags }) {
  const amountArg = args.pop();
  const u = await resolve(db, 'unit', args.join(' '));
  const cents = parseMoney(amountArg, 'payment');
  if (cents <= 0) throw new CliError('A payment is a positive amount. A reversal is: rates adjust <unit> <amount> --reason="..."');
  const actor = actorOf(flags);
  const on = parseDate(flags.on) || today();
  const y = await yearOf(db, flags);
  await tx(db, async () => {
    await db.query("insert into ledger (rating_unit_id, rating_year_id, kind, amount_cents, entry_on, ref, actor) values ($1, $2, 'payment', $3, $4, $5, $6)", [u.id, y.id, -cents, on, str(flags.ref) || 'Payment', actor]);
    await logActivity(db, actor, 'payment', u.assessment_no, `${nzc(cents)} received ${on}`);
  });
  const b = (await db.query('select balance_cents::bigint as balance_cents from v_unit_balance where rating_unit_id = $1', [u.id]))[0];
  return { data: { unit: u.assessment_no, paid_cents: cents, balance_cents: b.balance_cents }, text: () => `  ${nzc(cents)} recorded against ${u.assessment_no}. Balance now ${nzc(b.balance_cents)}.` };
}

async function cmdPenalties(db, { flags }) {
  const y = await yearOf(db, flags);
  if (flags.arrears) {
    const type = str(flags.type) || 'prior_year';
    const pct = Number(flags.pct || 10);
    if (!flags.apply) throw new CliError(`Add --apply --actor="Name" to add the ${type} penalty of ${pct}% on rates from earlier years.`);
    const actor = actorOf(flags);
    const on = parseDate(flags.on) || today();
    const n = await tx(db, async () => (await db.query('select apply_arrears_penalty($1, $2, $3, $4, $5) as n', [y.id, type, pct, on, actor]))[0].n);
    return { data: { year: y.label, type, pct, penalties: n }, text: () => `  ${n} penalties of ${pct}% added on rates from earlier years.` };
  }
  const i = await instalmentOf(db, y, flags.instalment);
  const rows = await db.query(`select u.assessment_no, u.address, n.ratepayer_names, x.unpaid_cents::bigint as unpaid_cents, round(x.unpaid_cents * $2::numeric / 100)::bigint as penalty_cents
    from unpaid_on_instalment($1, $3::date) x join rating_units u on u.id = x.rating_unit_id left join v_ratepayer_names n on n.rating_unit_id = u.id
    where x.unpaid_cents > 0 order by x.unpaid_cents desc`, [i.id, i.penalty_pct, isoDate(i.due_on)]);
  const total = rows.reduce((a, r) => a + num(r.penalty_cents), 0);
  if (!flags.apply) {
    return { data: { instalment: i.no, penalty_on: i.penalty_on, applied_on: i.penalties_applied_on, rows, total_cents: total }, text: () =>
      heading(`${y.label} instalment ${i.no}: ${Number(i.penalty_pct)}% penalty on what was unpaid at ${isoDate(i.due_on)}`) + '\n' +
      table(rows, [{ key: 'assessment_no', label: 'Assessment' }, { key: 'ratepayer_names', label: 'Ratepayer', width: 28 }, { key: 'unpaid_cents', label: 'Unpaid', align: 'right', format: nzc }, { key: 'penalty_cents', label: 'Penalty', align: 'right', format: nzc }]) +
      `\n  ${rows.length} penalties, ${nzc(total)}. ${i.penalties_applied_on ? `Already added on ${isoDate(i.penalties_applied_on)}.` : `Penalty date ${isoDate(i.penalty_on)}. Add them with --apply --actor="Name".`}` };
  }
  const actor = actorOf(flags);
  const on = parseDate(flags.on) || today();
  const n = await tx(db, async () => (await db.query('select apply_instalment_penalties($1, $2, $3) as n', [i.id, on, actor]))[0].n);
  return { data: { instalment: i.no, penalties: n, total_cents: total }, text: () => `  ${n} penalties added to instalment ${i.no}, ${nzc(total)}.` };
}

const STEPS = ['reminder', 'final_notice', 'arrangement', 'mortgagee_notice', 'mortgagee_demand', 'legal', 'note'];
async function cmdStep(db, { args, flags }) {
  const step = args.pop();
  if (!STEPS.includes(step)) throw new CliError(`Step is one of: ${STEPS.join(', ')}`);
  const u = await resolve(db, 'unit', args.join(' '));
  const actor = actorOf(flags);
  const on = parseDate(flags.on) || today();
  if (step === 'mortgagee_notice' && !(await db.query('select 1 from mortgagees where rating_unit_id = $1', [u.id])).length) throw new CliError(`${u.assessment_no} has no mortgagee on file. Add one first: rates mortgagee ${u.assessment_no} --lender="..."`);
  if (step === 'mortgagee_demand') {
    const a = (await db.query('select mortgagee_from from v_arrears where rating_unit_id = $1', [u.id]))[0];
    if (!a?.mortgagee_from) throw new CliError('Refused: notify the mortgagee first (s 62(1)(a)).');
    if (isoDate(a.mortgagee_from) > on) throw new CliError(`Refused: the mortgagee can be asked to pay from ${isoDate(a.mortgagee_from)}, 3 months after notice and not before 1 November of the next financial year (s 62(1)(c)).`);
  }
  await tx(db, async () => {
    await db.query('insert into arrears_actions (rating_unit_id, step, taken_on, actor, note) values ($1, $2, $3, $4, $5)', [u.id, step, on, actor, str(flags.note) || null]);
    await logActivity(db, actor, `arrears ${step}`, u.assessment_no, str(flags.note));
  });
  return { data: { unit: u.assessment_no, step, on }, text: () => `  ${step.replace('_', ' ')} recorded for ${u.assessment_no} on ${on}.` };
}

async function cmdMortgagee(db, { args, flags }) {
  const u = await resolve(db, 'unit', args.join(' '));
  const actor = actorOf(flags);
  if (!str(flags.lender)) throw new CliError('Give the lender: --lender="Bank name"');
  await tx(db, async () => {
    await db.query('insert into mortgagees (rating_unit_id, lender, registered_on) values ($1, $2, $3)', [u.id, str(flags.lender), parseDate(flags.registered)]);
    await logActivity(db, actor, 'mortgagee', u.assessment_no, str(flags.lender));
  });
  return { data: { unit: u.assessment_no, lender: flags.lender }, text: () => `  ${flags.lender} recorded as mortgagee of ${u.assessment_no}.` };
}

async function cmdReliefApply(db, { args, flags }) {
  const u = await resolve(db, 'unit', args.join(' '));
  const actor = actorOf(flags);
  const y = await yearOf(db, flags);
  const pol = (await db.query('select * from relief_policies where lower(code) = lower($1)', [str(flags.policy)]))[0];
  if (!pol) throw new CliError(`Which policy? --policy=${(await db.query('select code from relief_policies order by code')).map((r) => r.code).join('|')}`);
  const row = await tx(db, async () => {
    const r = (await db.query('insert into relief_applications (rating_unit_id, policy_code, rating_year_id, received_on, reason) values ($1, $2, $3, $4, $5) returning id', [u.id, pol.code, y.id, parseDate(flags.on) || today(), str(flags.reason) || null]))[0];
    await logActivity(db, actor, 'relief application', u.assessment_no, `${pol.code}: ${str(flags.reason)}`);
    return r;
  });
  return { data: { id: row.id, unit: u.assessment_no, policy: pol.code }, text: () => `  ${pol.name} application recorded for ${u.assessment_no} (${short(row.id)}).` };
}

async function findById(db, tableName, ref) {
  const q = str(ref).toLowerCase();
  if (q.length < 4) throw new CliError('Give the application id (the first 4 or more characters).');
  const rows = await db.query(`select * from ${tableName} where id::text like $1`, [`${q}%`]);
  if (rows.length !== 1) throw new CliError(rows.length ? `"${q}" matches ${rows.length} records: use more of the id.` : `No record starts with "${q}".`);
  return rows[0];
}

async function cmdReliefDecide(db, { args, flags }) {
  const [ref, decision] = args;
  const a = await findById(db, 'relief_applications', ref);
  if (a.status !== 'received') throw new CliError(`That application was ${a.status} on ${isoDate(a.decided_on)}.`);
  if (!['approve', 'decline', 'withdraw'].includes(decision)) throw new CliError('Decision is approve, decline or withdraw.');
  const actor = actorOf(flags);
  const on = parseDate(flags.on) || today();
  const pol = (await db.query('select * from relief_policies where code = $1', [a.policy_code]))[0];
  let cents = null;
  if (decision === 'approve' && pol.kind === 'remission') {
    cents = parseMoney(flags.amount, 'remission amount (--amount=)');
    const ass = (await db.query('select total_cents from assessments where rating_unit_id = $1 and rating_year_id = $2', [a.rating_unit_id, a.rating_year_id]))[0];
    const cap = Math.floor(num(ass?.total_cents) * num(pol.max_pct ?? 100) / 100);
    if (cents > cap) throw new CliError(`Refused: ${pol.name} allows up to ${pol.max_pct}% of this year's rates, ${nzc(cap)}.`);
  }
  const status = { approve: 'approved', decline: 'declined', withdraw: 'withdrawn' }[decision];
  await tx(db, async () => {
    await db.query('update relief_applications set status = $2, decided_on = $3, decided_by = $4, amount_cents = $5, reason = coalesce($6, reason) where id = $1', [a.id, status, on, actor, cents, str(flags.reason) || null]);
    if (cents) await db.query("insert into ledger (rating_unit_id, rating_year_id, kind, amount_cents, entry_on, ref, note, actor) values ($1, $2, 'remission', $3, $4, $5, $6, $7)", [a.rating_unit_id, a.rating_year_id, -cents, on, `${pol.code} remission`, pol.policy_ref, actor]);
    await logActivity(db, actor, `relief ${status}`, short(a.id), cents ? nzc(cents) : '');
  });
  return { data: { id: a.id, status, amount_cents: cents }, text: () => `  Application ${short(a.id)} ${status}${cents ? `: ${nzc(cents)} remitted (LGRA s 85, recorded under s 86)` : ''}.` };
}

async function cmdRebateAdd(db, { args, flags }) {
  const u = await resolve(db, 'unit', args.join(' '));
  const actor = actorOf(flags);
  const y = await yearOf(db, flags);
  const on = parseDate(flags.on) || today();
  if (on < isoDate(y.starts_on) || on > isoDate(y.ends_on)) throw new CliError(`Refused: a rebate application is made in the rating year it is for (Rates Rebate Act 1973 s 5). ${y.label} runs ${isoDate(y.starts_on)} to ${isoDate(y.ends_on)}.`);
  const ass = (await db.query('select total_cents from assessments where rating_unit_id = $1 and rating_year_id = $2', [u.id, y.id]))[0];
  const row = await tx(db, async () => {
    const r = (await db.query(`insert into rebate_applications (rating_unit_id, applicant, rating_year_id, received_on, household_income_cents, dependants, rates_payable_cents, note)
      values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`, [u.id, str(flags.applicant) || u.ratepayer_names, y.id, on, optMoney(flags.income), num(flags.dependants), ass?.total_cents ?? null, str(flags.note) || null]))[0];
    await logActivity(db, actor, 'rebate application', u.assessment_no, str(flags.applicant));
    return r;
  });
  return { data: { id: row.id }, text: () => `  Rebate application ${short(row.id)} recorded for ${u.assessment_no}. Work out the rebate on the current Department of Internal Affairs form, then: rates rebate-decide ${short(row.id)} approve --amount=...` };
}

async function cmdRebateDecide(db, { args, flags }) {
  const [ref, decision] = args;
  const a = await findById(db, 'rebate_applications', ref);
  if (a.status !== 'received') throw new CliError(`That application is already ${a.status}.`);
  if (!['approve', 'decline'].includes(decision)) throw new CliError('Decision is approve or decline.');
  const actor = actorOf(flags);
  const on = parseDate(flags.on) || today();
  const y = (await db.query('select * from rating_years where id = $1', [a.rating_year_id]))[0];
  if (decision === 'approve' && (isoDate(a.received_on) > isoDate(y.ends_on) || isoDate(a.received_on) < isoDate(y.starts_on))) throw new CliError(`Refused: received ${isoDate(a.received_on)}, outside ${y.label} (Rates Rebate Act 1973 s 5). Decline it.`);
  const cents = decision === 'approve' ? parseMoney(flags.amount, 'rebate amount (--amount=)') : null;
  await tx(db, async () => {
    await db.query("update rebate_applications set status = $2, decided_on = $3, rebate_cents = $4 where id = $1", [a.id, decision === 'approve' ? 'approved' : 'declined', on, cents]);
    if (cents) await db.query("insert into ledger (rating_unit_id, rating_year_id, kind, amount_cents, entry_on, ref, note, actor) values ($1, $2, 'rebate', $3, $4, 'Rates rebate', 'Rates Rebate Act 1973', $5)", [a.rating_unit_id, a.rating_year_id, -cents, on, actor]);
    await logActivity(db, actor, `rebate ${decision}`, short(a.id), cents ? nzc(cents) : '');
  });
  return { data: { id: a.id, decision, rebate_cents: cents }, text: () => `  Rebate ${short(a.id)} ${decision === 'approve' ? `approved: ${nzc(cents)} credited` : 'declined'}.` };
}

async function cmdRebateClaimed(db, { flags }) {
  const actor = actorOf(flags);
  const on = parseDate(flags.on) || today();
  const rows = await tx(db, async () => {
    const r = await db.query("update rebate_applications set status = 'claimed', claimed_on = $1 where status = 'approved' returning id, applicant, rebate_cents", [on]);
    await logActivity(db, actor, 'rebate claim', `${r.length} rebates`, `claimed from the Department of Internal Affairs on ${on}`);
    return r;
  });
  const total = rows.reduce((a, r) => a + num(r.rebate_cents), 0);
  return { data: { claimed: rows.length, total_cents: total }, text: () => `  ${rows.length} approved rebates marked claimed on ${on}, ${nzc(total)}.` };
}

async function cmdObject(db, { args, flags }) {
  const u = await resolve(db, 'unit', args.join(' '));
  const actor = actorOf(flags);
  if (!str(flags.grounds)) throw new CliError('Give the grounds: --grounds="..." (s 29: a unit omitted, roll information left out or wrong, other information wrong, or an amendment not entered)');
  const row = await tx(db, async () => {
    const r = (await db.query('insert into objections (rating_unit_id, objector, received_on, grounds) values ($1, $2, $3, $4) returning id', [u.id, str(flags.objector) || u.ratepayer_names || 'Unknown', parseDate(flags.on) || today(), str(flags.grounds)]))[0];
    await logActivity(db, actor, 'objection', u.assessment_no, str(flags.grounds));
    return r;
  });
  return { data: { id: row.id }, text: () => `  Objection ${short(row.id)} recorded against ${u.assessment_no}.` };
}

async function cmdObjectDecide(db, { args, flags }) {
  const [ref, decision] = args;
  const o = await findById(db, 'objections', ref);
  if (!['upheld', 'dismissed', 'withdrawn'].includes(decision)) throw new CliError('Decision is upheld, dismissed or withdrawn.');
  if (o.status !== 'open') throw new CliError(`That objection is already ${o.status}.`);
  const actor = actorOf(flags);
  await tx(db, async () => {
    await db.query('update objections set status = $2, decided_on = $3, decided_by = $4, outcome = $5 where id = $1', [o.id, decision, parseDate(flags.on) || today(), actor, str(flags.outcome) || null]);
    await logActivity(db, actor, `objection ${decision}`, short(o.id), str(flags.outcome));
  });
  return { data: { id: o.id, decision }, text: () => `  Objection ${short(o.id)} ${decision}.${decision === 'upheld' ? ' Correct the record (rates revalue, rates transfer, or /customise for a category change).' : ''}` };
}

async function cmdTransfer(db, { args, flags }) {
  const u = await resolve(db, 'unit', args.join(' '));
  const actor = actorOf(flags);
  const on = parseDate(flags.on) || today();
  const names = str(flags.to).split(/\s*;\s*/).filter(Boolean);
  if (!names.length) throw new CliError('Give the new owner: --to="Name" (several: --to="Name One; Name Two")');
  await tx(db, async () => {
    await db.query('update unit_ratepayers set until_on = $2 where rating_unit_id = $1 and until_on is null', [u.id, addDays(on, -1)]);
    for (const name of names) {
      let r = (await db.query('select id from ratepayers where lower(name) = lower($1)', [name]))[0];
      if (!r) r = (await db.query('insert into ratepayers (name, postal_address, email) values ($1, $2, $3) returning id', [name, str(flags.address) || null, str(flags.email) || null]))[0];
      await db.query('insert into unit_ratepayers (rating_unit_id, ratepayer_id, from_on) values ($1, $2, $3)', [u.id, r.id, on]);
    }
    await logActivity(db, actor, 'transfer', u.assessment_no, `from ${u.ratepayer_names || 'nobody'} to ${names.join(' and ')} on ${on} (s 31 notice of sale)`);
  });
  return { data: { unit: u.assessment_no, to: names, on }, text: () => `  ${u.assessment_no} now rated to ${names.join(' and ')} from ${on}. Rates already owing stay on the unit (s 59).` };
}

async function cmdWithhold(db, { args, flags }) {
  const r = await resolve(db, 'ratepayer', args.join(' '));
  const actor = actorOf(flags);
  const off = !!flags.off;
  await tx(db, async () => {
    await db.query('update ratepayers set withhold_name = $2, withhold_requested_on = case when $2 then coalesce(withhold_requested_on, $3) else withhold_requested_on end where id = $1', [r.id, !off, parseDate(flags.on) || today()]);
    await logActivity(db, actor, off ? 'withhold revoked' : 'withhold', r.name, off ? 'written revocation (s 28C(4))' : 'written request (s 28C)');
  });
  return { data: { ratepayer: r.name, withheld: !off }, text: () => `  ${r.name}: name and postal address ${off ? 'shown again' : 'withheld'} on the public copy of the database. Write to confirm (s 28C(3)(b)).` };
}

async function cmdRevalue(db, { args, flags }) {
  const u = await resolve(db, 'unit', args.join(' '));
  const actor = actorOf(flags);
  const cv = parseMoney(flags.cv, 'capital value (--cv=)');
  const lv = parseMoney(flags.lv, 'land value (--lv=)');
  const on = parseDate(flags.on) || today();
  await tx(db, async () => {
    await db.query('update rating_units set capital_value_cents = $2, land_value_cents = $3, valuation_date = $4 where id = $1', [u.id, cv, lv, on]);
    await logActivity(db, actor, 'revalue', u.assessment_no, `CV ${nz(u.capital_value_cents)} to ${nz(cv)}, LV ${nz(u.land_value_cents)} to ${nz(lv)}, effective ${on}${str(flags.reason) ? ': ' + flags.reason : ''}`);
  });
  return { data: { unit: u.assessment_no, capital_value_cents: cv, land_value_cents: lv, valuation_date: on }, text: () => `  ${u.assessment_no} values now CV ${nz(cv)}, LV ${nz(lv)} at ${on}. Rates already struck stay as assessed; the change applies from the next strike.` };
}

async function cmdWriteOff(db, { args, flags }) {
  const amountArg = args.pop();
  const u = await resolve(db, 'unit', args.join(' '));
  const cents = parseMoney(amountArg, 'amount to write off');
  const actor = actorOf(flags);
  if (!str(flags.reason)) throw new CliError('Write-offs need the chief executive\'s reason: --reason="..." (s 90A)');
  const bal = num((await db.query('select balance_cents::bigint as b from v_unit_balance where rating_unit_id = $1', [u.id]))[0]?.b);
  if (cents > bal) throw new CliError(`Refused: ${u.assessment_no} owes ${nzc(bal)}.`);
  await tx(db, async () => {
    await db.query("insert into ledger (rating_unit_id, kind, amount_cents, entry_on, ref, note, actor) values ($1, 'write_off', $2, $3, 'Write-off (s 90A)', $4, $5)", [u.id, -cents, parseDate(flags.on) || today(), str(flags.reason), actor]);
    await logActivity(db, actor, 'write-off', u.assessment_no, `${nzc(cents)}: ${flags.reason}`);
  });
  return { data: { unit: u.assessment_no, written_off_cents: cents }, text: () => `  ${nzc(cents)} written off ${u.assessment_no}. Notify the ratepayer (s 90A(3)).` };
}

async function cmdAdjust(db, { args, flags }) {
  const amountArg = args.pop();
  const u = await resolve(db, 'unit', args.join(' '));
  const cents = parseMoney(amountArg);
  const actor = actorOf(flags);
  if (!str(flags.reason)) throw new CliError('An adjustment needs a reason: --reason="..."');
  await tx(db, async () => {
    await db.query("insert into ledger (rating_unit_id, kind, amount_cents, entry_on, ref, note, actor) values ($1, 'adjustment', $2, $3, 'Adjustment', $4, $5)", [u.id, cents, parseDate(flags.on) || today(), str(flags.reason), actor]);
    await logActivity(db, actor, 'adjustment', u.assessment_no, `${nzc(cents)}: ${flags.reason}`);
  });
  return { data: { unit: u.assessment_no, amount_cents: cents }, text: () => `  Adjustment of ${nzc(cents)} on ${u.assessment_no}.` };
}

async function cmdLog(db, { args, flags }) {
  const note = args.pop();
  const u = await resolve(db, 'unit', args.join(' '));
  const actor = actorOf(flags);
  await tx(db, async () => {
    await db.query("insert into arrears_actions (rating_unit_id, step, taken_on, actor, note) values ($1, 'note', $2, $3, $4)", [u.id, parseDate(flags.on) || today(), actor, note]);
    await logActivity(db, actor, 'note', u.assessment_no, note);
  });
  return { data: { unit: u.assessment_no, note }, text: () => `  Note added to ${u.assessment_no}.` };
}

// ---------------------------------------------------------------- import and export

// TechnologyOne report layouts depend on how each council set them up, so each
// field accepts the column names councils commonly use. docs/replace-technologyone.md.
const COLS = {
  assessment: ['Assessment Number', 'Assessment No', 'Assessment', 'Rate Account', 'Property Number'],
  valuation: ['Valuation Number', 'Valuation Reference', 'Valuation Ref', 'Val Ref'],
  address: ['Property Address', 'Address', 'Location', 'Street Address'],
  locality: ['Locality', 'Suburb', 'Town'],
  legal: ['Legal Description', 'Legal'],
  category: ['Differential Category', 'Differential', 'Category', 'Rating Category'],
  lv: ['Land Value', 'LV'],
  cv: ['Capital Value', 'CV'],
  vdate: ['Valuation Date', 'Effective Date', 'Revaluation Date'],
  area: ['Area (ha)', 'Area', 'Land Area'],
  suips: ['SUIPs', 'SUIP', 'Separately Used Parts'],
  rateable: ['Rateable Percent', 'Rateable %', 'Rateable'],
  water: ['Water', 'Water Connected'],
  wastewater: ['Wastewater', 'Sewer', 'Wastewater Connected'],
  refuse: ['Refuse', 'Kerbside', 'Rubbish'],
  name: ['Ratepayer Name', 'Owner Name', 'Name', 'Ratepayer'],
  postal: ['Postal Address', 'Mailing Address'],
  email: ['Email', 'Email Address'],
  withheld: ['Name Withheld', 'Withheld', 'Suppressed'],
  arrears: ['Arrears', 'Balance', 'Outstanding', 'Amount Owing'],
};

async function cmdImport(db, { args, flags }) {
  const [source, dir] = args;
  if (source !== 'technologyone' || !dir) throw new CliError('Usage: rates import technologyone <folder with properties.csv, ratepayers.csv, balances.csv> [--dry-run] --actor="Name"');
  const read = (f) => { const p = path.resolve(dir, f); return existsSync(p) ? parseCsv(readFileSync(p, 'utf8')) : []; };
  const props = read('properties.csv');
  const owners = read('ratepayers.csv');
  const balances = read('balances.csv');
  if (!props.length) throw new CliError(`No properties.csv rows in ${dir}.`);
  const cats = new Set((await db.query('select code from categories')).map((r) => r.code));
  const problems = [];
  const units = props.map((r, i) => {
    const u = {
      no: pick(r, ...COLS.assessment), vref: pick(r, ...COLS.valuation) || null, address: pick(r, ...COLS.address), locality: pick(r, ...COLS.locality) || null,
      legal: pick(r, ...COLS.legal) || null, cat: pick(r, ...COLS.category).toUpperCase().slice(0, 3),
      lv: pick(r, ...COLS.lv), cv: pick(r, ...COLS.cv), vdate: pick(r, ...COLS.vdate), area: pick(r, ...COLS.area) || null,
      suips: Number(pick(r, ...COLS.suips) || 1), pct: Number(pick(r, ...COLS.rateable) || 100),
      w: yesNo(pick(r, ...COLS.water)), ww: yesNo(pick(r, ...COLS.wastewater)), rf: yesNo(pick(r, ...COLS.refuse)),
    };
    if (!u.no) problems.push(`properties.csv row ${i + 2}: no assessment number`);
    if (!u.address) problems.push(`properties.csv row ${i + 2}: no address`);
    if (!cats.has(u.cat)) problems.push(`properties.csv row ${i + 2}: category "${u.cat}" is not one of ${[...cats].join(', ')} (add it with /customise or map it)`);
    if (![0, 50, 100].includes(u.pct)) problems.push(`properties.csv row ${i + 2}: rateable percent ${u.pct} is not 0, 50 or 100`);
    try { u.lv = parseMoney(u.lv, 'land value'); u.cv = parseMoney(u.cv, 'capital value'); u.vdate = parseDate(u.vdate) || null; } catch (e) { problems.push(`properties.csv row ${i + 2}: ${e.message}`); }
    return u;
  });
  const known = new Set(units.map((u) => u.no));
  for (const [i, r] of owners.entries()) if (!known.has(pick(r, ...COLS.assessment))) problems.push(`ratepayers.csv row ${i + 2}: assessment "${pick(r, ...COLS.assessment)}" is not in properties.csv`);
  for (const [i, r] of balances.entries()) if (!known.has(pick(r, ...COLS.assessment))) problems.push(`balances.csv row ${i + 2}: assessment "${pick(r, ...COLS.assessment)}" is not in properties.csv`);
  const existing = new Set((await db.query('select assessment_no from rating_units')).map((r) => r.assessment_no));
  const clash = units.filter((u) => existing.has(u.no));
  if (clash.length) problems.push(`${clash.length} assessment numbers are already here (${clash.slice(0, 5).map((u) => u.no).join(', ')}): the import adds new units only`);
  const summary = { units: units.length, ratepayers: owners.length, balances: balances.length, arrears_cents: balances.reduce((a, r) => { try { return a + parseMoney(pick(r, ...COLS.arrears)); } catch { return a; } }, 0) };
  if (problems.length) throw new CliError(`Import refused, nothing written:\n${problems.slice(0, 30).map((p) => '  - ' + p).join('\n')}`);
  if (flags['dry-run']) return { data: { dry_run: true, ...summary }, text: () => `  Test run, nothing written: ${summary.units} units, ${summary.ratepayers} ratepayer links, ${summary.balances} balances totalling ${nzc(summary.arrears_cents)}.` };
  const actor = actorOf(flags);
  const asAt = parseDate(flags['as-at']) || today();
  await tx(db, async () => {
    for (const u of units) {
      await db.query(`insert into rating_units (assessment_no, valuation_ref, address, locality, legal_description, category_code, land_value_cents, capital_value_cents, valuation_date, area_ha, suips, rateable_pct, water_connected, wastewater_connected, refuse_service, created_on)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, $16)`, [u.no, u.vref, u.address, u.locality, u.legal, u.cat, u.lv, u.cv, u.vdate, u.area, u.suips, u.pct, u.w, u.ww, u.rf, addDays(asAt, -3650)]);
    }
    for (const r of owners) {
      const name = pick(r, ...COLS.name);
      let rp = (await db.query('select id from ratepayers where lower(name) = lower($1) and coalesce(postal_address, \'\') = $2', [name, pick(r, ...COLS.postal)]))[0];
      if (!rp) rp = (await db.query('insert into ratepayers (name, postal_address, email, withhold_name) values ($1, $2, $3, $4) returning id', [name, pick(r, ...COLS.postal) || null, pick(r, ...COLS.email) || null, yesNo(pick(r, ...COLS.withheld))]))[0];
      await db.query('insert into unit_ratepayers (rating_unit_id, ratepayer_id, from_on) select id, $2, $3 from rating_units where assessment_no = $1', [pick(r, ...COLS.assessment), rp.id, asAt]);
    }
    for (const r of balances) {
      const cents = parseMoney(pick(r, ...COLS.arrears));
      if (!cents) continue;
      await db.query(`insert into ledger (rating_unit_id, kind, amount_cents, entry_on, ref, note, actor) select id, $2, $3, $4, 'Opening balance', 'Carried in from TechnologyOne', $5 from rating_units where assessment_no = $1`,
        [pick(r, ...COLS.assessment), cents > 0 ? 'arrears_brought_forward' : 'payment', cents, addDays(asAt, -1), actor]);
    }
    await logActivity(db, actor, 'import', 'technologyone', JSON.stringify(summary));
  });
  return { data: summary, text: () => `  Imported ${summary.units} units, ${summary.ratepayers} ratepayer links and ${summary.balances} opening balances (${nzc(summary.arrears_cents)}).` };
}

const EXPORT_TABLES = ['settings', 'categories', 'rating_units', 'ratepayers', 'unit_ratepayers', 'mortgagees', 'rating_years', 'rate_types', 'rate_differentials', 'instalments',
  'assessments', 'assessment_lines', 'invoices', 'ledger', 'relief_policies', 'relief_applications', 'rebate_applications', 'objections', 'arrears_actions', 'activity'];
async function cmdExport(db, { flags }) {
  const file = path.resolve(REPO_ROOT, str(flags.file) || `exports/council-rates-${today()}.json`);
  if (existsSync(file)) throw new CliError(`${path.relative(REPO_ROOT, file)} exists. Choose a new --file=.`);
  const out = { exported_at: new Date().toISOString(), tables: {} };
  for (const t of EXPORT_TABLES) out.tables[t] = await db.query(`select * from ${t}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2), { mode: 0o600 });
  const counts = Object.fromEntries(Object.entries(out.tables).map(([k, v]) => [k, v.length]));
  return { data: { file: path.relative(REPO_ROOT, file), counts }, text: () => `  Exported ${EXPORT_TABLES.length} record types to ${path.relative(REPO_ROOT, file)}.` };
}

// ---------------------------------------------------------------- drafts

async function cmdDraftLetter(db, { args, flags }) {
  const kind = str(flags.kind) || 'reminder';
  if (!['reminder', 'final', 'mortgagee'].includes(kind)) throw new CliError('--kind=reminder|final|mortgagee');
  const u = await resolve(db, 'unit', args.join(' '));
  const a = (await db.query('select * from v_arrears where rating_unit_id = $1', [u.id]))[0];
  if (!a) throw new CliError(`${u.assessment_no} has nothing overdue.`);
  const s = (await db.query('select * from settings'))[0];
  const m = (await db.query('select lender from mortgagees where rating_unit_id = $1 limit 1', [u.id]))[0];
  if (kind === 'mortgagee' && !m) throw new CliError(`${u.assessment_no} has no mortgagee on file.`);
  const to = kind === 'mortgagee' ? m.lender : (u.ratepayer_names || 'The ratepayer');
  const body = {
    reminder: `Our records show ${nzc(a.overdue_cents)} in rates is overdue on ${u.address} (assessment ${u.assessment_no}), the oldest amount due on ${isoDate(a.oldest_unpaid_due)}.\n\nPlease pay this now. If you cannot pay in full, call us to set up a payment arrangement. Penalties are added to rates left unpaid after each penalty date.`,
    final: `This is a final notice. ${nzc(a.overdue_cents)} in rates on ${u.address} (assessment ${u.assessment_no}) has been overdue for ${a.days_overdue} days.\n\nIf it is not paid or an arrangement made within 14 days, the council will take the next recovery step, which may include asking the first mortgagee to pay under section 62 of the Local Government (Rating) Act 2002.`,
    mortgagee: `Under section 62(1)(a) of the Local Government (Rating) Act 2002 we notify you, as first mortgagee of ${u.address} (${u.legal_description || u.assessment_no}), that the owner is in default in paying rates of ${nzc(a.overdue_cents)}.\n\nIf the rates remain unpaid 3 months after this notice, and not earlier than 1 November in the financial year after the rates were first assessed, the council may recover them from you as a debt under section 62(1)(c). An amount you pay is added to the money secured by the mortgage (s 62(3)).`,
  }[kind];
  const html = `<!doctype html><meta charset="utf-8"><title>${kind} ${u.assessment_no}</title><body style="font:15px/1.6 system-ui;max-width:680px;margin:40px auto">
<p><strong>${s.council_name}</strong></p><p>${today()}</p><p>${to}<br>${u.address}</p><p>Assessment ${u.assessment_no}</p>
${body.split('\n\n').map((p) => `<p>${p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>`).join('')}
<p>Rates team<br>${s.council_name}</p><p style="color:#888;font-size:12px">DRAFT for review. Not sent.</p></body>`;
  mkdirSync(path.join(REPO_ROOT, 'drafts'), { recursive: true });
  let file = path.join(REPO_ROOT, 'drafts', `${kind}-${u.assessment_no}-${today()}.html`);
  for (let n = 2; existsSync(file); n++) file = path.join(REPO_ROOT, 'drafts', `${kind}-${u.assessment_no}-${today()}-${n}.html`);
  writeFileSync(file, html, { mode: 0o600 });
  return { data: { file: path.relative(REPO_ROOT, file), to, overdue_cents: a.overdue_cents }, text: () => `  Draft ${kind} letter to ${to} written to ${path.relative(REPO_ROOT, file)}. Nothing is sent.` };
}

// ---------------------------------------------------------------- help and dispatch

const COMMANDS = {
  units: [cmdUnits, 'units [--category=RES] [--locality=] [--arrears]', 'The roll: every rating unit, its value, ratepayer, rates and balance'],
  unit: [cmdUnit, 'unit <assessment|address|name>', 'One unit: values, ratepayers, this year\'s rates line by line, ledger and arrears steps'],
  ratepayers: [cmdRatepayers, 'ratepayers', 'Everyone on the rating information database'],
  ratepayer: [cmdRatepayer, 'ratepayer <name>', 'One ratepayer and their units'],
  years: [cmdYears, 'years', 'Rating years, resolutions and what was assessed'],
  rates: [cmdRates, 'rates [--year=]', 'The rates set by resolution: basis, rate or charge, differentials'],
  preview: [cmdPreview, 'preview <unit> [--year=]', 'What a unit pays if assessed now, line by line'],
  revenue: [cmdRevenue, 'revenue [--year=]', 'Revenue by rate and the s 21 uniform charge share'],
  instalments: [cmdInstalments, 'instalments [--year=]', 'Due dates, penalty dates, invoiced and unpaid'],
  arrears: [cmdArrears, 'arrears [--min-days=30]', 'Who is behind, oldest first, and the next step on the ladder'],
  ledger: [cmdLedger, 'ledger <unit>', 'Every charge, penalty, payment and credit on a unit'],
  relief: [cmdRelief, 'relief [--open]', 'Remission and postponement applications'],
  rebates: [cmdRebates, 'rebates [--open]', 'Rates rebate applications and claims'],
  objections: [cmdObjections, 'objections [--open]', 'Objections to the rating information database'],
  rid: [cmdRid, 'rid [<unit>]', 'The public copy of the rating information database, withheld names hidden'],
  calendar: [cmdCalendar, 'calendar [--days=60]', 'Due dates, penalty dates and deadlines coming up'],
  compliance: [cmdCompliance, 'compliance', 'Checks the records against the Act, each finding cited'],
  attention: [cmdAttention, 'attention', 'What needs doing now'],
  history: [cmdHistory, 'history [--limit=30]', 'Who did what'],
  strike: [cmdStrike, 'strike [--year=] [--confirm --actor=]', 'The strike: test run by default, --confirm issues the rates assessments'],
  'assess-late': [cmdAssessLate, 'assess-late <unit> --actor=', 'Part-year assessment for a unit added after the strike'],
  invoice: [cmdInvoice, 'invoice --instalment=N [--on=] --actor=', 'Invoice an instalment for every assessed unit'],
  pay: [cmdPay, 'pay <unit> <amount> [--on=] [--ref=] --actor=', 'Record a payment the bank received'],
  penalties: [cmdPenalties, 'penalties --instalment=N [--apply] | --arrears --type=prior_year|further --pct=10 --apply', 'Penalties under s 58: preview, then add'],
  step: [cmdStep, 'step <unit> <reminder|final_notice|arrangement|mortgagee_notice|mortgagee_demand|legal> [--note=] --actor=', 'Record an arrears step'],
  mortgagee: [cmdMortgagee, 'mortgagee <unit> --lender= [--registered=] --actor=', 'Record a first mortgagee'],
  'relief-apply': [cmdReliefApply, 'relief-apply <unit> --policy=CODE --reason= --actor=', 'Record a remission or postponement application'],
  'relief-decide': [cmdReliefDecide, 'relief-decide <id> approve|decline|withdraw [--amount=] --actor=', 'Decide it; an approved remission credits the ledger'],
  'rebate-add': [cmdRebateAdd, 'rebate-add <unit> --applicant= --income= --dependants= --actor=', 'Record a rates rebate application'],
  'rebate-decide': [cmdRebateDecide, 'rebate-decide <id> approve|decline --amount= --actor=', 'Decide a rebate; approval credits the ledger'],
  'rebate-claimed': [cmdRebateClaimed, 'rebate-claimed [--on=] --actor=', 'Mark approved rebates claimed from the Department of Internal Affairs'],
  object: [cmdObject, 'object <unit> --objector= --grounds= --actor=', 'Record an objection to the database (s 29)'],
  'object-decide': [cmdObjectDecide, 'object-decide <id> upheld|dismissed|withdrawn --outcome= --actor=', 'Decide an objection'],
  transfer: [cmdTransfer, 'transfer <unit> --to="Name; Name" [--on=] [--address=] --actor=', 'Change of ownership (s 31)'],
  withhold: [cmdWithhold, 'withhold <ratepayer> [--off] --actor=', 'Withhold a name from the public database (s 28C)'],
  revalue: [cmdRevalue, 'revalue <unit> --cv= --lv= [--on=] [--reason=] --actor=', 'New values from the valuation provider'],
  'write-off': [cmdWriteOff, 'write-off <unit> <amount> --reason= --actor=', 'Write off rates that cannot be recovered (s 90A)'],
  adjust: [cmdAdjust, 'adjust <unit> <amount> --reason= --actor=', 'A correcting entry (negative to credit)'],
  log: [cmdLog, 'log <unit> "<note>" --actor=', 'A note on the unit\'s arrears file'],
  import: [cmdImport, 'import technologyone <folder> [--dry-run] [--as-at=] --actor=', 'Bring the roll, ratepayers and balances across'],
  export: [cmdExport, 'export [--file=]', 'Everything to one JSON file'],
  'draft-letter': [cmdDraftLetter, 'draft-letter <unit> [--kind=reminder|final|mortgagee]', 'Draft an arrears letter to drafts/ (never sent)'],
};

function help(json) {
  const rows = Object.entries(COMMANDS).map(([name, [, usage, what]]) => ({ name, usage, what }));
  if (json) return { data: rows, text: () => '' };
  return { data: rows, text: () => `Council Rates for Claude Code\n\n  npm run rates -- <command> [--json]\n\n${rows.map((r) => `  ${r.usage}\n      ${r.what}`).join('\n')}\n\nWrites need --actor="Your name" (or RATES_ACTOR). Units match by assessment number, address or ratepayer name.` };
}

async function main() {
  const { args, flags } = parseArgv(process.argv.slice(2));
  const name = args.shift();
  if (!name || name === 'help' || (flags.help && !name)) {
    const h = help(flags.json);
    console.log(flags.json ? JSON.stringify(h.data, null, 2) : h.text());
    return;
  }
  const cmd = COMMANDS[name];
  if (!cmd) throw new CliError(`Unknown command "${name}". Run: npm run rates -- help`);
  const db = await getDb();
  try {
    const out = await cmd[0](db, { args, flags });
    console.log(flags.json ? JSON.stringify(out.data, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2) : out.text());
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e instanceof CliError ? e.message : (e.stack || String(e)));
  process.exit(typeof e.code === 'number' ? e.code : 1);
});
