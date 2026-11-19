---
description: Record a rates rebate application, decide it, or mark rebates claimed.
---

New: `npm run rates -- rebate-add "<unit>" --applicant="<name>" --income=<dollars> --dependants=N --actor="<name>"` (refused outside the rating year).
Decide: work the rebate out on the current Department of Internal Affairs form, then `npm run rates -- rebate-decide <id> approve --amount=<dollars> --actor="<name>"` or `decline`.
Claimed: `npm run rates -- rebate-claimed --actor="<name>"` once the claim has gone to the Department.
