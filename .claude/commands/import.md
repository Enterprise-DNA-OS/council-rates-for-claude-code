---
description: Bring the roll, ratepayers and opening balances across from TechnologyOne.
---

1. Read docs/replace-technologyone.md.
2. Put properties.csv, ratepayers.csv and balances.csv in a folder under imports/ (git ignores it). Check the column names against the guide; rename any that differ.
3. Test run: `npm run rates -- import technologyone imports/<folder> --dry-run`. Show the counts and the arrears total, and have the operator check them against TechnologyOne's own totals.
4. On a yes: `npm run rates -- import technologyone imports/<folder> --as-at=<cutover date> --actor="<name>"`. Any problem refuses the whole file and nothing is written.
