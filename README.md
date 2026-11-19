<h1 align="center">Council Rates for Claude Code</h1>

<p align="center">
  <strong>The open-source council rating system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your TechnologyOne data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=technologyone">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/technologyone?utm_source=github&utm_medium=readme&utm_campaign=technologyone">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-technologyone">Instead of TechnologyOne</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Council Rates for Claude Code does the job you pay TechnologyOne for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the TechnologyOne dashboard cannot.

One New South Wales council's contracts register lists A$317,302 a year in TechnologyOne OneCouncil fees from its second year, rising with CPI ([Snowy Valleys Council, Technology One Limited, annual SaaS fees for OneCouncil](https://www.snowyvalleys.nsw.gov.au/files/assets/public/v/1/gipa/contracts-register/q2022-08-annual-saas-agreement-fee-cia-live-and-extension-technology-one-class-2.pdf)). That figure covers the whole OneCouncil suite, not rating alone. This repository covers the property and rating part.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=technologyone).

It is for the rates team of a New Zealand district or city council, or anyone who runs rating for one. It holds the rating units and their values, the ratepayers on the rating information database, the rates the council sets by resolution each year (general rate with differentials, uniform annual general charge, targeted rates by value, by unit, by separately used part or by connection), the strike, rates assessments, instalment invoices, the rates ledger, penalties, arrears and the recovery steps, remissions, postponements, rates rebates and objections. The rules the Local Government (Rating) Act 2002 puts on the numbers sit in the database itself: a penalty over 10 percent, an invoice before its assessment, a second strike and an early demand on a mortgagee are all refused.

It does not hold the general ledger, take payments, run payroll or make valuations: payments come from your bank file, values from your valuation service provider.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/council-rates-for-claude-code.git
cd council-rates-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`. The demo is Ruaroa District Council, a fictional district with 24 rating units, and its records are deliberately messy: a ratepayer 141 days behind whose mortgagee nobody has notified, penalties due and not added, a sold house with no new owner on the database, a rural unit missed in the last revaluation, a hardship application waiting 33 working days, a rebate never claimed back.

`npm test` runs every command against a throwaway database (87 steps).

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

39 slash commands, each a short recipe over one CLI (`npm run rates -- help` lists its 41 verbs). Every read takes `--json`. Units match by assessment number, valuation reference, address or ratepayer name; an ambiguous match lists the candidates and stops. Every write needs a person: `--actor="Name"` or `RATES_ACTOR`.

### The working week

1. `/attention` lists what needs doing, each with the command that does it.
2. `/arrears` puts the overdue units in order with the next step on the ladder; `/chase` drafts the letter and records the step.
3. `/instalment-run` invoices the next instalment; `/penalties` adds the s 58 penalties on the penalty date.
4. `/relief`, `/rebates` and `/objection` clear what is waiting on a decision.
5. `/weekly-review` writes the Monday page from the arrears, instalments and attention list.

| Command | What it does |
|---|---|
| `/arrears` | Who is behind on rates, oldest first, with the next step on the council's ladder. |
| `/assess-late` | Assess a unit added to the roll after the strike (a new subdivision lot), for the rest of the year. |
| `/attention` | What needs doing now across the whole rates book. |
| `/calendar` | Rating dates coming up: due dates, penalty dates, invoice run dates, rebate and objection deadlines, mortgagee dates. |
| `/chase` | Record an arrears step: reminder, final notice, arrangement, mortgagee notice, mortgagee demand or legal referral. |
| `/compliance` | Check the records against the Local Government (Rating) Act 2002 and related rules, each finding cited. |
| `/customise` | Make this system yours in plain language. Add a field, rename stages, change a rule, add a column to a document. Writes the migration, applies it, updates the commands that touch it. |
| `/decide-rebate` | Record a rates rebate application, decide it, or mark rebates claimed. |
| `/decide-relief` | Record a remission or postponement application, or decide one. |
| `/documents` | Render the paperwork: rates assessments, instalment invoices and arrears statements. |
| `/draft-letter` | Draft an arrears letter: reminder, final notice, or the s 62 notice to a mortgagee. |
| `/export` | Export every record to one JSON file. |
| `/help` | Every CLI command and its arguments. |
| `/history` | Who changed what, and when. |
| `/import` | Bring the roll, ratepayers and opening balances across from TechnologyOne. |
| `/instalment-run` | The instalment cycle from end to end: invoice, render, then penalties on the penalty date. |
| `/instalments` | Instalment due dates, penalty dates, what was invoiced and what is still unpaid. |
| `/invoice` | Invoice an instalment for every assessed unit. |
| `/log` | A note on a unit's arrears file: a call, a promise to pay, a visit. |
| `/new-view` | Add a read-only HTML view (a dashboard page) from a plain-language description, rendered in the operator's brand by `npm run view`. |
| `/objection` | Record an objection to the rating information database (s 29) or decide one. |
| `/pay` | Record a payment the bank has already received. |
| `/penalties` | Penalties on unpaid rates under s 58: preview, then add on the penalty date. |
| `/preview` | What one unit pays if assessed now, line by line. Use it before the strike, after a revaluation, or to answer "why is my bill this much". |
| `/ratepayer` | One ratepayer and every unit they are rated for. |
| `/rates` | The rates set by resolution this year: basis, rate or charge, who pays, differentials. |
| `/rebates` | Rates rebate applications: to decide, to claim back, and any made outside their rating year. |
| `/relief` | Remission and postponement applications, open ones first. |
| `/revalue` | Enter new values from the valuation service provider for one unit. |
| `/revenue` | Rates revenue by rate and the uniform charge share under s 21. |
| `/rid` | The public copy of the rating information database (s 27, s 28), with withheld names hidden. |
| `/strike` | The annual strike: test run, then issue the rates assessments for every unit on the roll. |
| `/transfer` | Change of ownership: end the old ratepayer and start the new one (s 31 notice of sale). |
| `/unit` | Everything about one rating unit: values, ratepayers, this year's rates line by line, ledger and arrears steps. |
| `/units` | List the rating units on the roll, with value, ratepayer, this year's rates and balance. |
| `/views` | Render the read-only dashboards: this week in rates, and revenue. |
| `/weekly-review` | The Monday rates review, written from the arrears, the instalments and the attention list. |
| `/withhold` | Withhold a ratepayer's name and postal address from the public database on their written request (s 28C), or show it again. |
| `/write-off` | Write off rates that cannot reasonably be recovered (s 90A). |

## Ten questions TechnologyOne's screens do not answer in one step

Each one is a single ask here, answered from the demo data by a shipped command.

1. Which ratepayers are behind and have a first mortgagee nobody has notified yet? (`/arrears`)
2. On what date can we ask each notified mortgagee to pay, under the 3 months and 1 November rule in s 62? (`/calendar`)
3. What share of rates revenue comes from uniform charges, against the 30 percent limit in s 21? (`/revenue`)
4. What would this property pay if we struck the rates today, line by line? (`/preview`)
5. Which units are on the roll with no rates assessment this year? (`/compliance`)
6. Which units have no ratepayer on the rating information database? (`/compliance`)
7. Which values are over 3 years old and were missed in the last general revaluation? (`/compliance`)
8. Which penalty dates have passed with penalties not added, and what would they raise? (`/penalties`)
9. Which remission applications have waited longer than our policy allows, in working days? (`/relief`)
10. Which approved rebates have we not claimed back from the Department of Internal Affairs? (`/rebates`)

## Documents and views

`npm run docs` renders a rates assessment per unit, an invoice per instalment per unit and an arrears statement per overdue unit into docs-out/, in the council's name, colours and logo from brand.json. `npm run view` renders views/week.html (arrears, instalments, what is waiting, gaps in the database) and views/revenue.html. `/draft-letter` writes reminder, final and mortgagee letters to drafts/. Nothing is ever sent from here.

## Your first hour: ten things to ask for

1. Put our council's name, colours and logo in brand.json.
2. Set our arrears ladder and remission decision time in settings.
3. Load our differential categories and relief policies.
4. Import our roll, ratepayers and opening balances from TechnologyOne, test run first.
5. Check the import totals against TechnologyOne's own.
6. Enter this year's rates resolution and the rates it set.
7. Preview five properties we know the answer for.
8. Run the strike as a test and compare it with the annual plan.
9. Show me what needs attention.
10. Write this week's rates review.

## Instead of TechnologyOne

Run three reports in TechnologyOne Property and Rating (the property list with values and services, the ratepayer list, and balances as at your cutover date), save each as CSV, put them in a folder and run:

```bash
npm run rates -- import technologyone imports/cutover --dry-run
npm run rates -- import technologyone imports/cutover --as-at=2027-06-30 --actor="Your name"
```

Each field accepts the column names councils commonly use. Report layouts depend on how your council set TechnologyOne up, so check yours against the list in [the switching guide](docs/replace-technologyone.md) and rename any that differ (or ask Claude Code to). A problem anywhere refuses the whole import and writes nothing. History before the cutover stays in TechnologyOne's archive; the balance carries across as one opening entry per unit.

## Architecture

```
council-rates-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Council Rates for Claude Code for your business, migrates your TechnologyOne data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=technologyone)
- Read more: [enterprisedna.co/omni/instead-of/technologyone](https://enterprisedna.co/omni/instead-of/technologyone?utm_source=github&utm_medium=readme&utm_campaign=technologyone)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
