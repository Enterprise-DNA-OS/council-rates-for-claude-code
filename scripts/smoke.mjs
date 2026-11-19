#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Migrate, seed, then every CLI command, asserting on the JSON. Then the rules
// the database enforces, an import from a TechnologyOne-shaped export, the
// documents, the views and the export. Passes on Windows and Linux. No network.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'rates-smoke-'));
const work = mkdtempSync(path.join(tmpdir(), 'rates-smoke-files-'));
const env = { ...process.env, DATA_DIR: dataDir, RATES_ACTOR: 'Smoke Test' };
delete env.DATABASE_URL;

let step = 0;
function run(label, args, { json = true, expectFail = false, script = 'rates.mjs', extraEnv = {} } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', script), ...args, ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try { return JSON.parse(res.stdout); } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}
function assert(cond, msg) {
  if (!cond) { console.error(`\nFAIL assertion: ${msg}`); process.exit(1); }
}
const n = (v) => Number(v ?? 0);

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', [], { json: false, script: 'migrate.mjs' });
  run('migrate again (idempotent)', [], { json: false, script: 'migrate.mjs' });
  run('seed', [], { json: false, script: 'seed.mjs' });
  run('seed again (idempotent)', [], { json: false, script: 'seed.mjs' });

  // ---- the roll
  const help = run('help', ['help']);
  assert(help.length >= 40, `help lists every command (${help.length})`);
  const units = run('units', ['units']);
  assert(units.length === 24, `24 rating units (${units.length})`);
  assert(units.some((u) => !u.ratepayer_names), 'one unit with no ratepayer on file');
  assert(units.filter((u) => u.rates_cents == null).length === 1, 'one unit not assessed this year');
  const rural = run('units --category=RUR', ['units', '--category=RUR']);
  assert(rural.length === 4 && rural.every((u) => u.category_code === 'RUR'), 'four rural units');
  const behind = run('units --arrears', ['units', '--arrears']);
  assert(behind.length === 9, `nine units behind (${behind.length})`);

  const unit = run('unit by assessment number', ['unit', '10010-007']);
  assert(unit.unit.address === '31 Rimu Terrace', 'resolved by assessment number');
  assert(unit.mortgagees.length === 1 && unit.arrears.next_step.includes('mortgagee'), 'the mortgagee is next for Dennis Hart');
  assert(unit.lines.length === 5, 'five rates lines on a connected house');
  const byName = run('unit by ratepayer name', ['unit', 'Whitfield']);
  assert(byName.unit.assessment_no === '40040-002', 'resolved by ratepayer name');
  const ambiguous = run('an ambiguous reference lists candidates and exits 1', ['unit', 'Kowhai'], { json: false, expectFail: true });
  assert(/matches \d+ unit records/.test(ambiguous.stderr), 'it lists candidates rather than guessing');
  const none = run('an unknown unit exits 1', ['unit', 'Nowhere Street'], { json: false, expectFail: true });
  assert(/No unit matches/.test(none.stderr), 'and says so');

  const ratepayers = run('ratepayers', ['ratepayers']);
  assert(ratepayers.some((r) => r.withhold_name), 'a withheld name');
  const rp = run('ratepayer', ['ratepayer', 'Grace Liu']);
  assert(rp.units.length === 1, 'Grace Liu has one unit');

  // ---- the rates
  const years = run('years', ['years']);
  assert(years.length === 2 && years[0].struck_on, 'two years, this one struck');
  const rates = run('rates', ['rates']);
  assert(rates.rate_types.length === 7, 'seven rate types');
  assert(rates.rate_types.find((r) => r.code === 'GEN').differentials.includes('COM 2.2'), 'commercial differential 2.2');
  const school = run('preview: non-rateable school pays service rates only', ['preview', '50050-001']);
  assert(school.lines.every((l) => ['WATER', 'WW'].includes(l.code)) && school.total_cents === 158000, 'water and wastewater only (s 9, Schedule 1)');
  const club = run('preview: half-rateable club', ['preview', 'Bowling']);
  assert(club.lines.find((l) => l.code === 'GEN').amount_cents === Math.round(52000000 * 0.0021 * 2.2 * 0.5), 'half the general rate');
  const flats = run('preview: three flats pay three UAGCs', ['preview', '10010-003']);
  assert(flats.lines.find((l) => l.code === 'UAGC').amount_cents === 144000, 'per separately used part');
  const revenue = run('revenue', ['revenue']);
  assert(revenue.total_cents === 11261345, `total rates ${revenue.total_cents}`);
  assert(revenue.uniform_share > 10 && revenue.uniform_share < 30, 'uniform charges under the s 21 limit');
  const inst = run('instalments', ['instalments']);
  assert(inst.instalments.length === 4 && inst.instalments[0].penalties_applied_on && !inst.instalments[1].penalties_applied_on, 'instalment 1 penalised, 2 not yet');

  // ---- what needs attention (read before anything changes)
  const arrears = run('arrears', ['arrears']);
  assert(arrears.length === 9 && arrears[0].assessment_no === '10010-007', 'worst first');
  assert(arrears.find((a) => a.assessment_no === '10010-009').next_step === 'send the final notice', 'reminder sent, final notice next');
  assert(arrears.find((a) => a.assessment_no === '10010-012').next_step === 'watch the arrangement', 'an arrangement is watched');
  const serious = run('arrears --min-days=90', ['arrears', '--min-days=90']);
  assert(serious.length === 4, 'four past 90 days');
  const compliance = run('compliance', ['compliance']);
  const has = (rule, subject) => compliance.some((f) => f.rule.startsWith(rule) && (!subject || f.subject === subject));
  assert(has('LGRA s 27', '10010-010'), 'no ratepayer on the database');
  assert(has('Rating Valuations Act', '30030-004'), 'value over 3 years old');
  assert(has('LGRA s 44', '10010-013'), 'new unit not assessed');
  assert(has('LGRA s 58(1)(a)'), 'instalment 2 penalties due');
  assert(has('LGRA s 29', '20020-002'), 'objection open');
  assert(has('Council policy', '30030-002'), 'hardship application overdue for a decision');
  assert(has('Rates Rebate Act 1973 s 5', '10010-008'), 'late rebate application');
  assert(compliance.some((f) => f.rule === 'Rates Rebate Act 1973' && f.subject === '10010-006'), 'rebate not claimed');
  assert(has('Overpaid', '10010-011'), 'overpayment');
  assert(!has('LGRA s 21'), 'no s 21 finding');
  const attention = run('attention', ['attention']);
  assert(attention.length >= 10 && attention.every((a) => a.severity !== 'watch'), 'attention is the work list');
  const calendar = run('calendar', ['calendar', '--days=120']);
  assert(calendar.some((c) => /instalment 3/.test(c.what)), 'instalment 3 on the calendar');
  const rid = run('rid public copy', ['rid']);
  assert(rid.find((r) => r.assessment_no === '10010-005').ratepayers.startsWith('Withheld'), 's 28C name withheld');
  assert(rid.find((r) => r.assessment_no === '10010-001').ratepayers === 'Aroha Tane and Mike Tane', 'other names shown');
  const relief = run('relief', ['relief', '--open']);
  assert(relief.length === 1 && relief[0].policy === 'HARD', 'one open hardship application');
  const rebates = run('rebates', ['rebates']);
  assert(rebates.length === 2, 'two rebate applications');
  const objections = run('objections', ['objections', '--open']);
  assert(objections.length === 1, 'one open objection');
  const ledger = run('ledger', ['ledger', '10010-007']);
  assert(ledger.some((l) => l.penalty_type === 'prior_year') && ledger.some((l) => l.penalty_type === 'instalment'), 'both penalty types on the ledger');

  // ---- the rules the database holds
  run('a second strike is refused', ['strike', '--confirm'], { json: false, expectFail: true });
  run('instalment 2 penalties cannot be added before their date', ['penalties', '--instalment=2', '--apply', '--on=' + inst.instalments[1].due_on], { json: false, expectFail: true });
  const prev = run('penalty preview', ['penalties', '--instalment=2']);
  assert(prev.rows.length === 9 && prev.total_cents === 115876, `nine penalties, $1,158.76 (${prev.total_cents})`);
  const pen = run('add instalment 2 penalties', ['penalties', '--instalment=2', '--apply']);
  assert(pen.penalties === 9, 'nine added');
  run('and not twice', ['penalties', '--instalment=2', '--apply'], { json: false, expectFail: true });
  const over = run('a penalty over 10 percent is refused (s 58)', ['penalties', '--arrears', '--type=further', '--pct=12', '--apply'], { json: false, expectFail: true });
  assert(/10 percent/.test(over.stderr), 'and says why');
  const early = run('a further penalty before six months is refused', ['penalties', '--arrears', '--type=further', '--pct=10', '--apply'], { json: false, expectFail: true });
  assert(/six months/.test(early.stderr), 's 58(1)(c)');
  run('instalment 4 cannot be invoiced before 3', ['invoice', '--instalment=4'], { json: false, expectFail: true });
  const demand = run('the mortgagee cannot be asked before notice', ['step', '10010-007', 'mortgagee_demand'], { json: false, expectFail: true });
  assert(/notify the mortgagee first/.test(demand.stderr), 's 62(1)(a)');
  const noActor = run('no actor, no write', ['pay', '10010-009', '100'], { json: false, expectFail: true, extraEnv: { RATES_ACTOR: '' } });
  assert(/--actor/.test(noActor.stderr), 'it asks who');

  // ---- the weekly work
  const notice = run('notify the mortgagee', ['step', '10010-007', 'mortgagee_notice', '--note=Notice posted to Kiwi Home Loans']);
  assert(notice.step === 'mortgagee_notice', 'recorded');
  const after = run('the next step is to wait for s 62(1)(c)', ['unit', '10010-007']);
  assert(after.arrears.next_step.startsWith('wait: the mortgagee can be asked from'), after.arrears.next_step);
  const tooSoon = run('asking the mortgagee now is refused', ['step', '10010-007', 'mortgagee_demand'], { json: false, expectFail: true });
  assert(/3 months after notice/.test(tooSoon.stderr), 'and cites the 3 months and 1 November');
  run('final notice for Jason Bell', ['step', 'Jason Bell', 'final_notice']);
  const paid = run('Jason Bell pays', ['pay', '10010-009', '2008.06', '--ref=Internet banking']);
  assert(paid.balance_cents === 0, `cleared (${paid.balance_cents})`);
  const arrears2 = run('arrears after the payment', ['arrears']);
  assert(!arrears2.some((a) => a.assessment_no === '10010-009'), 'off the list');
  const late = run('assess the new subdivision lot', ['assess-late', '50 Totara Avenue']);
  assert(late.total_cents > 0 && late.total_cents < 300000, `part-year assessment ${late.total_cents}`);
  run('and only once', ['assess-late', '10010-013'], { json: false, expectFail: true });
  const i3 = run('invoice instalment 3', ['invoice', '--instalment=3']);
  assert(i3.invoices === 24, `23 struck units and the late lot (${i3.invoices})`);
  const newUnit = run('the new lot\'s instalment 3 carries half its part-year rates', ['unit', '10010-013']);
  const lateInv = newUnit.ledger.find((l) => l.kind === 'rates');
  assert(Math.abs(n(lateInv.amount_cents) - late.total_cents / 2) <= 1, 'split over the two instalments left');
  run('transfer the sold house', ['transfer', '44 Totara Avenue', '--to=Priya Shah; Arjun Shah', '--address=44 Totara Avenue, Ruaroa']);
  const sold = run('the new owners are on the database', ['unit', '10010-010']);
  assert(sold.unit.ratepayer_names === 'Arjun Shah and Priya Shah' || sold.unit.ratepayer_names === 'Priya Shah and Arjun Shah', sold.unit.ratepayer_names);
  assert(n(sold.balance.balance_cents) > 0, 'the rates owing stay with the unit (s 59)');
  run('revalue the missed rural unit', ['revalue', '30030-004', '--cv=1950000', '--lv=1350000', '--reason=Missed in the general revaluation']);
  const decision = run('decide the hardship application', ['relief-decide', relief[0].id.slice(0, 8), 'approve', '--amount=1000']);
  assert(decision.status === 'approved' && decision.amount_cents === 100000, 'approved, credited');
  run('a remission over the policy cap is refused', ['relief-apply', '30030-001', '--policy=HARD', '--reason=Flood']);
  const r2 = run('relief list', ['relief', '--open']);
  const capRefused = run('over half the year is refused', ['relief-decide', r2[0].id.slice(0, 8), 'approve', '--amount=5000'], { json: false, expectFail: true });
  assert(/allows up to 50%/.test(capRefused.stderr), 'policy cap');
  const lateRebate = rebates.find((r) => r.applicant === 'Mere Paku');
  run('a late rebate cannot be approved', ['rebate-decide', lateRebate.id.slice(0, 8), 'approve', '--amount=500'], { json: false, expectFail: true });
  run('decline it', ['rebate-decide', lateRebate.id.slice(0, 8), 'decline']);
  const rb = run('a new rebate application', ['rebate-add', '9 Matai', '--applicant=Tom Ngata', '--income=24000']);
  run('a duplicate decision path still works', ['rebate-decide', rb.id.slice(0, 8), 'decline']);
  const claimed = run('claim approved rebates', ['rebate-claimed']);
  assert(claimed.claimed === 1 && claimed.total_cents === 70000, 'one claim of $700');
  const obj = run('record an objection', ['object', '22 Rata Road', '--grounds=Area is wrong on the database']);
  run('uphold it', ['object-decide', obj.id.slice(0, 8), 'upheld', '--outcome=Area corrected from the roll']);
  run('decide the Bayview objection', ['object-decide', objections[0].id.slice(0, 8), 'dismissed', '--outcome=Upstairs is offices on inspection']);
  run('withhold a name', ['withhold', 'Grace Liu']);
  const rid2 = run('rid one unit', ['rid', '10010-002']);
  assert(rid2[0].ratepayers.startsWith('Withheld'), 'withheld now');
  run('show it again', ['withhold', 'Grace Liu', '--off']);
  run('add a mortgagee', ['mortgagee', '40040-002', '--lender=Southern Bank']);
  run('write off what cannot be recovered', ['write-off', '40040-002', '10', '--reason=Small balance, uneconomic to recover']);
  run('a write-off above the balance is refused', ['write-off', '20020-001', '99999', '--reason=test'], { json: false, expectFail: true });
  run('adjust', ['adjust', '10010-011', '-50', '--reason=Overpayment refunded to the ratepayer']);
  run('note', ['log', '10010-007', 'Called the mortgagee, file passed to their collections team']);
  const hist = run('history', ['history', '--limit=100']);
  assert(hist.length >= 20 && hist.every((h) => h.actor), 'every change has a person');
  const after2 = run('compliance after the work', ['compliance']);
  assert(!after2.some((f) => f.rule.startsWith('LGRA s 27')), 'no unit without a ratepayer');
  assert(!after2.some((f) => f.rule.startsWith('Rating Valuations Act')), 'no stale values');
  assert(!after2.some((f) => f.rule.startsWith('LGRA s 58(1)(a)')), 'penalties added');
  assert(!after2.some((f) => f.rule.startsWith('LGRA s 44')), 'every unit assessed');

  // ---- drafts
  const draft = run('draft a final notice', ['draft-letter', '40040-002', '--kind=final']);
  assert(existsSync(path.join(root, draft.file)), 'draft written');
  const mdraft = run('draft the mortgagee letter', ['draft-letter', '10010-007', '--kind=mortgagee']);
  assert(readFileSync(path.join(root, mdraft.file), 'utf8').includes('section 62(1)(a)'), 'cites s 62');
  for (const f of [draft.file, mdraft.file]) rmSync(path.join(root, f));

  // ---- import from a TechnologyOne-shaped export
  const imp = path.join(work, 't1');
  mkdirSync(imp);
  writeFileSync(path.join(imp, 'properties.csv'), 'Assessment Number,Valuation Number,Property Address,Locality,Legal Description,Differential Category,Land Value,Capital Value,Valuation Date,Area (ha),SUIPs,Water,Wastewater,Refuse\r\n' +
    '60060-001,06260/001.00,"1 Beach Road, Unit A",Kahu Bay,Lot 1 DP 1,Residential,"$410,000","$880,000",01/09/2025,0.05,1,Yes,Yes,Yes\r\n' +
    '60060-002,06260/002.00,3 Beach Road,Kahu Bay,Lot 2 DP 1,Lifestyle,500000,990000,2025-09-01,3.1,1,No,No,Yes\r\n');
  writeFileSync(path.join(imp, 'ratepayers.csv'), 'Assessment Number,Ratepayer Name,Postal Address,Name Withheld\n60060-001,Ana Moana,PO Box 1 Kahu Bay,No\n60060-002,Sam Lee,3 Beach Road,Yes\n');
  writeFileSync(path.join(imp, 'balances.csv'), 'Assessment Number,Arrears\n60060-002,"1,234.50"\n');
  const dry = run('import test run', ['import', 'technologyone', imp, '--dry-run']);
  assert(dry.dry_run && dry.units === 2 && dry.arrears_cents === 123450, 'test run reads both files');
  const imported = run('import', ['import', 'technologyone', imp]);
  assert(imported.units === 2, 'imported');
  const u60 = run('imported unit', ['unit', '60060-002']);
  assert(u60.unit.category_code === 'LIF' && n(u60.balance.balance_cents) === 123450, 'category mapped, balance carried in');
  run('importing the same units again is refused', ['import', 'technologyone', imp], { json: false, expectFail: true });
  writeFileSync(path.join(imp, 'properties.csv'), 'Assessment Number,Property Address,Differential Category,Land Value,Capital Value\n70070-001,9 Hill Road,Farm,1,2\n');
  const bad = run('an unknown category is refused, nothing written', ['import', 'technologyone', imp], { json: false, expectFail: true });
  assert(/category "FAR"/.test(bad.stderr), 'names the bad category');

  // ---- documents, views, export
  const docs = run('npm run docs', [], { json: false, script: 'docs.mjs' });
  assert(/\d+ document\(s\) rendered/.test(docs.stdout), 'documents rendered');
  const inv = readdirSync(path.join(root, 'docs-out', 'rates-invoice'));
  assert(inv.length >= 46, `invoices rendered (${inv.length})`);
  const views = run('npm run view', [], { json: false, script: 'view.mjs' });
  assert(/views\/week\.html|views\\week\.html/.test(views.stdout), 'week view rendered');
  const exp = run('export', ['export', `--file=${path.join(work, 'backup.json')}`]);
  assert(exp.counts.ledger > 90 && exp.counts.rating_units === 26, 'every record type exported');
  run('export refuses to overwrite', ['export', `--file=${path.join(work, 'backup.json')}`], { json: false, expectFail: true });

  console.log(`\nPASS: ${step} steps`);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
}
