---
description: Record a remission or postponement application, or decide one.
---

New: `npm run rates -- relief-apply "<unit>" --policy=<CODE> --reason="..." --actor="<name>"`.
Decide: `npm run rates -- relief-decide <id> approve|decline|withdraw --amount=<remitted dollars> --reason="..." --actor="<name>"`. An approved remission credits the ledger (s 85, recorded under s 86). The database refuses an amount over the policy's cap. The decision is the delegated officer's; you record it.
