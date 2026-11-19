---
description: The instalment cycle from end to end: invoice, render, then penalties on the penalty date.
---

1. `npm run rates -- instalments --json`: confirm the next instalment and its dates.
2. On a yes: `npm run rates -- invoice --instalment=N --actor="<name>"`, then `npm run docs -- rates-invoice`.
3. After the due date: `npm run rates -- arrears` and the reminder drafts.
4. On the penalty date: /penalties.
