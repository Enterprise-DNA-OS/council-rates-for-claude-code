# Council Rates for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Council:** [YOUR COUNCIL] (the demo is Ruaroa District Council, fictional)
- **Operator:** [YOUR NAME], [your role in the rates team]
- **What matters most:** rates collected on time, every unit on the roll assessed correctly, and every step the Act requires taken on time

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| who is behind on rates, oldest first, with the next step on the council's ladder | `/arrears` |
| assess a unit added to the roll after the strike (a new subdivision lot), for the rest of the year | `/assess-late` |
| what needs doing now across the whole rates book | `/attention` |
| rating dates coming up: due dates, penalty dates, invoice run dates, rebate and objection deadlines, mortgagee dates | `/calendar` |
| record an arrears step: reminder, final notice, arrangement, mortgagee notice, mortgagee demand or legal referral | `/chase` |
| check the records against the Local Government (Rating) Act 2002 and related rules, each finding cited | `/compliance` |
| make this system yours in plain language. Add a field, rename stages, change a rule, add a column to a document. Writes the migration, applies it, updates the commands that touch it | `/customise` |
| record a rates rebate application, decide it, or mark rebates claimed | `/decide-rebate` |
| record a remission or postponement application, or decide one | `/decide-relief` |
| render the paperwork: rates assessments, instalment invoices and arrears statements | `/documents` |
| draft an arrears letter: reminder, final notice, or the s 62 notice to a mortgagee | `/draft-letter` |
| export every record to one JSON file | `/export` |
| every CLI command and its arguments | `/help` |
| who changed what, and when | `/history` |
| bring the roll, ratepayers and opening balances across from TechnologyOne | `/import` |
| the instalment cycle from end to end: invoice, render, then penalties on the penalty date | `/instalment-run` |
| instalment due dates, penalty dates, what was invoiced and what is still unpaid | `/instalments` |
| invoice an instalment for every assessed unit | `/invoice` |
| a note on a unit's arrears file: a call, a promise to pay, a visit | `/log` |
| add a read-only HTML view (a dashboard page) from a plain-language description, rendered in the operator's brand by `npm run view` | `/new-view` |
| record an objection to the rating information database (s 29) or decide one | `/objection` |
| record a payment the bank has already received | `/pay` |
| penalties on unpaid rates under s 58: preview, then add on the penalty date | `/penalties` |
| what one unit pays if assessed now, line by line. Use it before the strike, after a revaluation, or to answer "why is my bill this much" | `/preview` |
| one ratepayer and every unit they are rated for | `/ratepayer` |
| the rates set by resolution this year: basis, rate or charge, who pays, differentials | `/rates` |
| rates rebate applications: to decide, to claim back, and any made outside their rating year | `/rebates` |
| remission and postponement applications, open ones first | `/relief` |
| enter new values from the valuation service provider for one unit | `/revalue` |
| rates revenue by rate and the uniform charge share under s 21 | `/revenue` |
| the public copy of the rating information database (s 27, s 28), with withheld names hidden | `/rid` |
| the annual strike: test run, then issue the rates assessments for every unit on the roll | `/strike` |
| change of ownership: end the old ratepayer and start the new one (s 31 notice of sale) | `/transfer` |
| everything about one rating unit: values, ratepayers, this year's rates line by line, ledger and arrears steps | `/unit` |
| list the rating units on the roll, with value, ratepayer, this year's rates and balance | `/units` |
| render the read-only dashboards: this week in rates, and revenue | `/views` |
| the Monday rates review, written from the arrears, the instalments and the attention list | `/weekly-review` |
| withhold a ratepayer's name and postal address from the public database on their written request (s 28C), or show it again | `/withhold` |
| write off rates that cannot reasonably be recovered (s 90A) | `/write-off` |

If an ask fits nothing here, run the CLI directly (`npm run rates -- help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.
- Every write names a person (`--actor`). Never invent an actor, a value, a payment or a decision.
- Decisions on remissions, rebates, objections and write-offs belong to the council's delegated officers. You record them; you never make them.
- Never put a name withheld under s 28C into anything that leaves the council.
- Never run `strike --confirm`, `invoice` or `penalties --apply` without a yes in this session. The database refuses the unlawful ones; the operator decides the rest.
- The ledger is append only. Fix a mistake with a correcting entry (`adjust`), never by editing.
- Read docs/compliance.md before answering a question about what the Act requires. Do not guess at law.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off TechnologyOne.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/technologyone
