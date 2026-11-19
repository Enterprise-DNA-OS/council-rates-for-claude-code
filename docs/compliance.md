# Compliance: the rules this system checks

`npm run rates -- compliance` checks the records against the rules below. Some are enforced by the database itself and cannot be broken through the CLI; the rest are findings for a person to act on. Every section was read on legislation.govt.nz on 19 November 2026. A clean list is not legal advice: the council's own advisers have the final word, and when the law changes, update this file and the check together.

Sources:
- Local Government (Rating) Act 2002 (LGRA): https://www.legislation.govt.nz/act/public/2002/0006/latest/whole.html
- Rating Valuations Act 1998: https://www.legislation.govt.nz/act/public/1998/0069/latest/whole.html
- Rates Rebate Act 1973: https://www.legislation.govt.nz/act/public/1973/0005/latest/whole.html
- Local Government Act 2002 (LGA), ss 102, 108 to 110: https://www.legislation.govt.nz/act/public/2002/0084/latest/whole.html

## Enforced by the database

| Rule | Source | What is refused |
|---|---|---|
| Rates are set by resolution before they are assessed | LGRA s 23 | `strike_year` refuses a year with no rates resolution, or a strike dated before it |
| One strike a year | LGRA s 43, s 44 | a second strike of the same year |
| Uniform charges at most 30 percent of rates revenue | LGRA s 21 | `strike --confirm` refuses when UAGCs plus targeted rates set on a uniform basis (other than those solely for water supply or sewage disposal) pass 30 percent |
| The assessment is delivered before the invoice | LGRA s 48(1) | `issue_instalment` refuses while any assessment for the year is unissued or dated after the invoice |
| Penalties need a resolution | LGRA s 57(1) | penalties refused with no penalty resolution recorded |
| A penalty is at most 10 percent of the unpaid rates | LGRA s 57(3)(a), s 58 | `instalments.penalty_pct` cannot exceed 10; `apply_arrears_penalty` refuses more |
| An instalment penalty is added on its date, once | LGRA s 57(2)(b), s 58(1)(a) | before the penalty date, or a second time |
| The penalty on earlier years' rates comes no earlier than the later of the year start and 5 working days after the resolution | LGRA s 58(1)(b) | an earlier date |
| A further penalty only 6 months after that one | LGRA s 58(1)(c) | sooner |
| A first mortgagee can be asked to pay only 3 months after notice, and not before 1 November in the financial year after the rates were first assessed | LGRA s 62(1)(c) | `step mortgagee_demand` before both dates, or with no notice recorded |
| A rebate application is made in the rating year it is for | Rates Rebate Act 1973 s 5(2) | `rebate-add` outside the year; `rebate-decide approve` for a late one |
| A remission stays within the adopted policy | LGRA s 85, LGA s 108 and s 109 | an approved amount over the policy's `max_pct` of the year's rates |
| The rates ledger is a record | LGRA s 37 (rates records), s 86 (recording remitted rates) | any update or delete on `ledger`: corrections are new entries |

## Findings for a person

| Finding | Source | What it looks for |
|---|---|---|
| No rates resolution, or rates set after the year began | LGRA s 23 | `rating_years.resolution_on` |
| Penalty resolution made after the rates were set | LGRA s 57(2)(a) | `penalty_resolution_on` later than `resolution_on` |
| Uniform charges within 3 points of the 30 percent limit | LGRA s 21 | revenue by rate |
| Penalty date passed, penalties not added | LGRA s 58(1)(a) | instalments invoiced, penalty date gone, `penalties_applied_on` empty |
| Unit on the roll with no rates assessment this year | LGRA s 44 | a new subdivision lot added after the strike: `assess-late` |
| Unit with no ratepayer on the rating information database | LGRA s 27 | usually a sale with no s 31 notice processed: `transfer` |
| Value more than 3 years old | Rating Valuations Act 1998 s 9 | a unit missed in the general revaluation |
| Objection to the database open more than 30 days | LGRA s 29 | `objections` |
| Remission or postponement waiting longer than the council's decision time | Council policy under LGA s 109 and s 110 | working days since received, against `settings.remission_decision_days` |
| Rebate application received outside its rating year | Rates Rebate Act 1973 s 5(2) | decline it |
| Approved rebate not claimed back | Rates Rebate Act 1973 | `rebate-claimed` once the claim is lodged with the Department of Internal Affairs |
| A withhold request not applied | LGRA s 28C | `withhold_requested_on` set and the name still public |
| Arrears step due on the council's ladder | Council policy; s 62 for mortgagees | `v_arrears.next_step` |
| Unpaid rates more than 5 years old | LGRA s 65 | recovery through the court must start within 6 years |
| Overpayment beyond the rest of the year's rates | Council policy | refund or hold |

## What this system does not decide

- How much rebate a ratepayer gets. Work it out on the Department of Internal Affairs form for the year; this system records the amount and the claim.
- Whether a remission, postponement, objection or write-off (LGRA s 90A) is granted. The delegated officer decides; this system records the decision and who made it.
- Values. They come from the council's valuation service provider under the Rating Valuations Act 1998.
- Māori freehold land rating beyond remission: Part 4 of the LGRA and the council's s 108 policy need the council's own advice before a rule is added here.
- Australian rating law. Each state's Local Government Act differs; adding one is a `/customise` job with that state's sections cited here first.
