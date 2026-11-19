---
description: Record an arrears step: reminder, final notice, arrangement, mortgagee notice, mortgagee demand or legal referral.
---

1. Read the unit first: `npm run rates -- unit "<unit>" --json`.
2. Draft the letter if there is one: `npm run rates -- draft-letter "<unit>" --kind=reminder|final|mortgagee`. It writes to drafts/ and is never sent from here.
3. Once it has gone, record it: `npm run rates -- step "<unit>" <step> --note="..." --actor="<name>"`. Asking a mortgagee to pay is refused until 3 months after the notice and 1 November of the next financial year (s 62(1)(c)).
