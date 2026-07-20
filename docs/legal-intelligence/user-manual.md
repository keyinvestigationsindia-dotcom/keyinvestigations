# User Manual — Legal & Investigation Intelligence

For investigators, QC reviewers, and admins using the Report Drafter (`report.html`). No technical background required.

## What this is

A section at the bottom of every investigation report, called **Legal & Investigation Intelligence**, that automatically cross-checks the documents you've entered for the case — catching things like a registration number that doesn't match between two documents, a permit that expired before the accident, or an inconsistent age across the petition and proof documents.

It does **not** replace your own review. Everything it produces is clearly marked **"Pending Verification"** — it's a second pair of eyes, not a final answer.

## Where to find it

Open a case in the Report Drafter. In the report preview panel on the right, scroll past the Conclusion — the Legal & Investigation Intelligence section is the last thing before the report's closing disclaimer.

## How to use it

1. **Fill in and tick the document categories you have** for the case (FIR Details, Vehicle RC Details, Age Proof, etc.) — the same fields you already fill in for the main report. This section reads from the same information; there's nothing extra to upload.
2. **Click "Refresh"** at the top of the Legal & Investigation Intelligence section.
3. Wait a few seconds. Each module that has enough information to check something will update; the rest will stay "Not Performed."
4. **Click on any module's name** to expand it and see what was found.

You can click Refresh again any time after adding more documents — it re-checks everything from scratch using whatever's currently filled in.

## What the statuses mean

| Status | Meaning |
|---|---|
| **Not Performed** | Either not enough information was provided to check this, or this module isn't built yet (see "What's not available yet" below). Nothing to review. |
| **Pending Verification** | The system found something to report. **You should read it and confirm it against the actual documents before relying on it in your report.** |
| **Completed** | Not currently used — reserved for a future workflow where an investigator formally signs off on a module's findings. |
| **Not Applicable** | Reserved for cases where a module doesn't apply to this claim type. Not currently used by any module. |

## What each module checks

- **Timeline Intelligence** — lists every dated event across your documents in order, and flags anything that doesn't make sense chronologically (like a certificate dated before the event it describes).
- **Vehicle Intelligence** — checks registration number, permit, fitness, and policy details for consistency and validity.
- **Person Intelligence** — checks names, ages, addresses, and relationships for consistency across documents.
- **Medical Intelligence** — checks whether medical documents agree with each other on dates, diagnosis, and billed amounts. It does **not** give a medical opinion or judge whether treatment was appropriate — only whether the paperwork is consistent.
- **Digital Evidence Intelligence** — checks whether the photographs/visual evidence you've described are complete and consistent with the rest of the file. It cannot examine actual photo files — only what you've written about them.
- **Cross Verification Summary** — checks whether the core story of the accident (where, when, how) is told the same way across the FIR, panchnama, DAR, site map, and chargesheet.
- **AI Investigation Findings** — flags things worth noticing about the *quality* of the evidence — for example, if the only account of the accident comes from one interested party rather than an independent witness.
- **Risk Assessment** — gives an overall risk level (low/medium/high) based on standard warning signs found in the documents (like an unexplained FIR delay), with the specific factors listed.
- **Investigator Alerts** — a checklist of standard items that appear to be missing, like a statement from the other driver, or eyewitness accounts.

## What's not available yet

**Court Case Intelligence, Litigation Intelligence, and Insurance Intelligence** will always show "Not Performed" in this version. These require checking external systems (court records, insurance industry databases) that aren't connected yet — they're reserved space in the report, not something you're missing by not filling in more documents. When they become available, they'll appear automatically without any change to how you use the report.

## A note on trust

Everything this section produces is generated from the text you've entered — it never looks anything up externally, and it's built to say "not stated" or "unclear" rather than guess. But it can still misread something, especially with unusual formatting or partial information. **Treat every "Pending Verification" item the same way you'd treat a colleague's first-pass note: worth checking, not worth citing without verifying.**

## Exports

Word, PDF, and Text downloads all include this section automatically — no separate step needed. Modules that found nothing to report ("Not Performed") appear as a single status line, not blank space; modules with findings show the full detail, exactly as it appears on screen.

## Getting help

If a module you'd expect to see something from keeps showing "Not Performed," check that the relevant document category is **ticked** and has **actual text filled into its fields** — a ticked category with empty fields has nothing for the system to read.
