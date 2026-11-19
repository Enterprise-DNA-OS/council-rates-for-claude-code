---
description: Penalties on unpaid rates under s 58: preview, then add on the penalty date.
---

1. Run `npm run rates -- penalties --instalment=N --json`: who, what was unpaid at the due date, the penalty.
2. On a yes, and on or after the penalty date, run `npm run rates -- penalties --instalment=N --apply --actor="<name>"`. The database refuses before the date, twice, over 10 percent, or with no penalty resolution (s 57).
3. Penalties on earlier years' rates: `npm run rates -- penalties --arrears --type=prior_year --pct=10 --apply --actor="<name>"`, and six months later `--type=further`.
