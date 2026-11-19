---
description: The annual strike: test run, then issue the rates assessments for every unit on the roll.
---

1. Run `npm run rates -- strike --json`. It is a test run: units, total, revenue by rate and the s 21 share. Nothing is written.
2. Show the operator the totals and compare with the revenue the annual plan sought. Point out anything odd (a rate raising nothing, a big change on last year).
3. Only on an explicit yes, run `npm run rates -- strike --confirm --actor="<name>"`. The database refuses a second strike and a year with no rates resolution.
4. Then render the assessments: `npm run docs -- rates-assessment`.
