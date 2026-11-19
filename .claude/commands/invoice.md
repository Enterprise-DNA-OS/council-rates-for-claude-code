---
description: Invoice an instalment for every assessed unit.
---

1. Run `npm run rates -- instalments --json` and confirm which instalment is next.
2. On a yes, run `npm run rates -- invoice --instalment=N --actor="<name>" --json`. The database refuses if the assessments have not gone out first (s 48) or an earlier instalment is not invoiced.
3. Render the invoices: `npm run docs -- rates-invoice`. Delivery is the council's mail run; nothing is sent from here.
