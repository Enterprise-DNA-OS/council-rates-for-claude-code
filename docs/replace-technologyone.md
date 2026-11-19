# Moving off TechnologyOne Property and Rating

This guide moves one council's rating records from TechnologyOne (OneCouncil, or the older Property and Rating module) into Council Rates for Claude Code. Allow one day for a prepared and reconciled cutover. The shape and completeness of your council's own reports set the real time.

## What comes across

| From TechnologyOne | File | Into |
|---|---|---|
| Property list with valuation, category and services | properties.csv | `rating_units` |
| Ratepayers per property, with withheld flags | ratepayers.csv | `ratepayers`, `unit_ratepayers` |
| Balance owing per property at the cutover date | balances.csv | one opening `ledger` entry per unit |

Each field accepts the column names below, matched without case. Report layouts depend on how your council configured TechnologyOne, so compare your headers with these and rename any that differ before the import (Claude Code can do the renaming).

| Field | Accepted column names |
|---|---|
| Assessment | Assessment Number, Assessment No, Assessment, Rate Account, Property Number |
| Valuation reference | Valuation Number, Valuation Reference, Valuation Ref, Val Ref |
| Address | Property Address, Address, Location, Street Address |
| Locality | Locality, Suburb, Town |
| Legal description | Legal Description, Legal |
| Category | Differential Category, Differential, Category, Rating Category (the first three letters must match a code in `categories`: RES, COM, IND, RUR, LIF in the demo) |
| Land value, capital value | Land Value or LV; Capital Value or CV (dollars, commas and $ allowed) |
| Valuation date | Valuation Date, Effective Date, Revaluation Date (YYYY-MM-DD or DD/MM/YYYY) |
| Area | Area (ha), Area, Land Area |
| Separately used parts | SUIPs, SUIP, Separately Used Parts |
| Rateable percent | Rateable Percent, Rateable %, Rateable (0, 50 or 100) |
| Services | Water or Water Connected; Wastewater, Sewer or Wastewater Connected; Refuse, Kerbside or Rubbish (Yes or No) |
| Ratepayer | Ratepayer Name, Owner Name, Name, Ratepayer; Postal Address or Mailing Address; Email; Name Withheld, Withheld or Suppressed |
| Balance | Arrears, Balance, Outstanding, Amount Owing (a credit is negative) |

## Steps

1. Pick the cutover date, usually the last day of a rating year (30 June) after the last instalment's penalties are added.
2. In TechnologyOne, run the three reports as at that date and save each as CSV (UTF-8). Put them in `imports/cutover/`. Git ignores that folder: it holds names and addresses.
3. Load your categories and relief policies (`/customise`), and your settings (arrears ladder, decision time).
4. Test run: `npm run rates -- import technologyone imports/cutover --dry-run`. Compare the unit count and the arrears total with TechnologyOne's own totals for the same date. Do not go on until they match.
5. Import: `npm run rates -- import technologyone imports/cutover --as-at=<cutover date> --actor="Your name"`. Any problem refuses the whole import and nothing is written.
6. Enter the new year's rates resolution and rates (`/customise` writes them as a migration or a script you keep), then `/strike` as a test run and compare with the annual plan.
7. Run the old and new side by side for one instalment if you can: invoice in both, compare totals unit by unit.

## What does not carry over

- Ledger history before the cutover. Each unit starts with one opening balance; keep TechnologyOne's archive (or an export of it) for enquiries and audit under your retention schedule.
- Payment receipting, bank reconciliation and the general ledger. Payments are recorded here from your bank file; journals still go to your finance system.
- Water meter reading and volumetric water billing. Add them with `/customise` if your council bills water by volume.
- Postponed rates registered as a charge on title (LGRA s 90): record each one as a note and an arrangement until a postponement register is added.
- Valuation objections. Those go to your valuation service provider under the Rating Valuations Act; only objections to the rating information database (LGRA s 29) are kept here.
