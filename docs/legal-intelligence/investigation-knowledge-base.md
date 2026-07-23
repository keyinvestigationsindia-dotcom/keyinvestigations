# Investigation Intelligence Knowledge Base

### Chief Investigation Scientist's brief — what should exist in an investigator's head, independent of what any software currently does

**Status:** Documentation only. No code, no prompts, no report changes. Nothing in the codebase was modified to produce this document, and nothing here should be read as a description of current system behavior.

**Purpose:** This is a first-principles capture of what an experienced field investigator (the kind of person with ~25 years in Indian motor-accident-claim investigation) knows and checks, largely independent of what the Legal & Investigation Intelligence Engine (or any other software in this family, including Bima Anveshak's Investigation Intelligence Engine) currently implements. It exists so future module design — new checks, new modules, prompt rewrites, report sections — has a real domain-expert reference to build from, instead of re-deriving investigative judgment from scratch each time or silently copying whatever the current code already does.

**How to use this document:** Each section names what to verify, why it matters, which documents carry the evidence, and what a genuine discrepancy vs. a merely cosmetic difference looks like. Treat gaps between this document and current system behavior as a backlog of candidate improvements, not as defects to fix immediately — closing all of them is a multi-phase effort, and prioritization is a separate decision from capturing the knowledge itself.

---

## SECTION 1 — THE PEOPLE

### 1.1 The Injured / Deceased

**Always verify:**
- **Identity chain**: same person named consistently across FIR → MLC → PM (if death) → Hospital records → Chargesheet → Claim Petition → Death Certificate. Spelling drift (Hindi→English transliteration) is *normal*, not suspicious by itself. **Age drift is the real signal** — a 2-3 year gap could be OCR/rounding; a 20+ year gap means either two different people are being conflated, or a fraudulent substitution.
- **Was this person actually where the documents say?** Cross-check Hospital admission time against accident time — is the gap physically plausible given real-world ambulance/travel time for that specific rural/urban route? A 5-minute gap over 40km is impossible; that's not "fast response," that's a fabricated timeline.
- **Occupation and income** — the single most fraud-exposed field in any MACT claim, because quantum is directly proportional to it. An expert always asks: is there ANY independent corroboration (ITR, salary slip, employer letter, Aadhaar occupation field, business registration) or is income *purely self-declared in the claim petition itself*? Self-declared-only income is a standing, permanent "Unable to Independently Verify" flag, not a number to accept at face value.
- **Relationship to the vehicle at the time of accident** — rider, pillion, pedestrian, occupant of the OTHER vehicle, or bystander who later claims injury? This single fact determines whether the claim is even the right *type* (TP vs OD vs a fraudulent third-party claim by someone who was actually the insured's own family member trying to claim against their own policy).
- **Pre-existing medical conditions** noted anywhere (MLC "H/O" — history of — fields, PM's internal examination notes) that could mean the injury/death was not *solely* attributable to the accident — this affects both quantum and, rarely, causation itself.
- **Why this matters**: this person is the center of gravity for the entire claim. Every other verification exists to confirm or contest facts *about* this person's injury/death and its cause.

**Documents that provide evidence**: FIR, MLC, Hospital Admission/Discharge records, Postmortem Report (death only), Death Certificate, Injury Certificate, Claim Petition, Statement 161 (if given before death/incapacitation).

**What verifies what**: MLC's stated injuries should match PM's external/internal findings (death case) or Discharge Summary's diagnosis (injury case) — a mismatch here (MLC says "minor head injury," PM says "massive internal hemorrhage") is a genuine, serious discrepancy worth its own line item, not folded into a generic "medical inconsistency."

**Related entities**: driver (if the injured person WAS the driver), family members who may separately be witnesses AND claimants (a real conflict-of-interest pattern), the hospital's own billing entity.

### 1.2 The Driver

**Always verify:**
- **Was the person named as "driver" in the FIR/Panchnama actually the SAME person who held the DL?** One of the most common substitution frauds: an unlicensed or already-disqualified person was driving, and a licensed family member's DL is produced afterward to paper over it. **Tell:** DL photo (if scanned) vs. any photo-ID in other documents; DL address vs. stated residence in 161 statement; does the DL's *issuing RTO* even make geographic sense for this person's stated life history?
- **DL class vs. vehicle class vs. actual vehicle GVW** — the Mukund Dewangan LMV≤7500kg rule covers the baseline, but an expert also checks: is this a *transport* vehicle requiring a badge/commercial endorsement the DL doesn't show, even if the raw class matches?
- **Employment relationship to the vehicle** — is the driver an employee of the owner (paid driver), a family member, or someone with NO stated relationship at all (a huge red flag — why was a stranger driving this vehicle)?
- **Alcohol/intoxication** — MLC of the driver (not just the victim) is the correct source, and it's routinely missing because investigators default to only pulling the *victim's* MLC. If the driver was also injured, their own MLC should be sought independently.
- **Driver's own account vs. every other account** — does the driver's 161 statement (if any) match the FIR's narration, which itself came from someone else's account? A driver's statement that contradicts the FIR in a self-serving direction (minimizing their own fault) is expected human behavior, not automatic fraud — but it IS worth flagging as "self-interested variance," a distinct category from an independent witness's contradiction.
- **Prior driving history** — genuinely hard to verify in India without a centralized, accessible database, but a seasoned investigator still asks the question and records "could not be verified — no centralized access" rather than silently skipping it.

### 1.3 The Registered Owner

**Always verify:**
- **Owner ≠ Driver ≠ Insured is completely normal** (commercial fleets, family vehicles) — but when Owner ≠ Insured, ask *why* — was the policy transferred at ownership transfer per Section 157 MVA? A vehicle sold but insurance never transferred is a real, common gap that can void the policy's applicability to the new owner.
- **Ownership chain continuity** — RC's registered owner name vs. Policy's insured name vs. Chargesheet's stated owner: three-way match expected; any single mismatch needs its own explanation, not a shrug.
- **Address consistency** — RC address vs. Policy address vs. FIR's stated address for the owner. Rural India has real, non-fraudulent reasons for address drift (seasonal migration, joint family properties, incomplete RTO updates) — but a *repeated pattern* of address mismatches across many fields on the SAME document set (not just one) shifts from "normal drift" to "possible identity confusion or straw ownership."
- **Vehicle usage declared to insurer vs. actual usage at time of accident** — a private car insured as "private use only" but found commercially loaded (goods, passengers-for-hire) at the time of the accident is a policy-breach fact pattern, independent of who was driving.

### 1.4 The Insured

**Always verify:**
- Is the Insured the same legal person as the Owner? If not, what's the insurable interest basis (financier, lessor, family arrangement)?
- **Policy continuity** — was this policy freshly issued right before the accident (a real, recurring fraud pattern: buy insurance the same week as a "planned" accident, or even backdate a policy after an accident already happened)? Compare policy issue date to accident date — a gap of days, not months, deserves explicit scrutiny, not just a pass/fail validity check.
- Premium payment proof — was the premium actually paid and cleared (not just a proposal form filled), especially for policies issued close to the accident date?

### 1.5 The Applicant / Claimant

**Always verify:**
- **Legal standing to claim** — spouse, parent, child, legal heir, or dependent? In a death claim, is this person on the SAME legal-heir list the Death Certificate / succession document would produce, or could there be OTHER heirs not party to this claim (a real, if not fraud-specific, legal-defensibility issue for the insurer)?
- **Relationship claimed vs. relationship provable** — "wife" claimed but no marriage certificate/ration card/Aadhaar joint-address evidence anywhere in file is an "Unable to Verify," not an assumed truth.
- **Dependency** (for quantum) — was the claimant genuinely financially dependent on the deceased, or is dependency being asserted without support? This is a MACT quantum question as much as a fraud question.
- **Multiple claimants for the same incident** — if more than one person files as "the" primary claimant/dependent, that alone is worth a cross-check, not necessarily fraud (large joint families are normal) but worth naming.

### 1.6 Witnesses

**Always verify (the "who actually SAW it" question — expert-level thinking goes further than presence/absence):**
- **Eyewitness vs. arrived-after vs. told-by-someone-else** — three genuinely different evidentiary weights, and a report should never blur them.
- **Relationship to the injured/claimant** — a witness who is ALSO a family member of the claimant is not automatically unreliable (in rural India, family members are very often the ONLY people present), but their evidentiary weight should be stated as "family witness" distinctly from "independent bystander witness."
- **Physical plausibility of their claimed vantage point** — could this person, from where they say they were standing/sitting, actually have seen what they claim? (Requires scene/road-type data — a witness on a curved highway 200m away claiming to see exact impact details is a real, checkable implausibility.)
- **Consistency between MULTIPLE witnesses' accounts of the SAME moment** — not just "does witness A contradict the FIR" but "does witness A contradict witness B," a genuinely distinct check from cross-referencing each statement only against the FIR.
- **Timing of when the statement was recorded** relative to the accident — a statement recorded weeks later has different weight than one recorded same-day, and "coached" statements (multiple witnesses using suspiciously identical phrasing) are a real, subtle fraud tell experienced investigators watch for.

---

## SECTION 2 — THE VEHICLE

**Always verify beyond RC/Permit/Fitness validity dates:**
- **Physical damage vs. claimed mechanism** — does the damage pattern (front/rear/side, height of impact) match the claimed collision type? A rear-end collision claim with front-bumper damage is a real, checkable contradiction — but this requires either photographs (with actual content analysis, not just presence-count) or a detailed MVI/Survey report.
- **Odometer reading** at time of accident vs. RC's registration date — implausible mileage (too low for the vehicle's age, suggesting odometer tampering, or too high for a "rarely used" claim) is a classic total-loss-fraud tell.
- **Was this vehicle involved in a PRIOR claim, especially a prior total-loss or salvage claim?** If a "totaled" vehicle reappears in a new accident, that's a serious, specific fraud pattern (salvage fraud) — needs a vehicle-number history check across the insurer's own records, distinguishing "prior total loss" as its own category from an ordinary repeat-vehicle match.
- **Load and passenger count vs. permitted capacity** — an overloaded goods vehicle or a passenger vehicle carrying more than its seating capacity is both a genuine causal factor AND a policy-condition-breach question.
- **Aftermarket modifications** — was the vehicle modified (structural, engine, seating) in a way that voids policy conditions or changes its legal classification? RC's original spec vs. what the Panchnama/MVI physically describes.

---

## SECTION 3 — TIMELINE INTELLIGENCE

This deserves the deepest treatment because it's where fabrication is hardest to sustain — liars are consistent in what they SAY but inconsistent in TIMING, because timing has to match physical reality across multiple independent sources.

**Every investigation should build a literal minute-by-minute chain, not just a list of dates:**
```
Accident time (FIR) → Public/bystander informed → Police informed (compare to General Diary entry time) →
Ambulance dispatched → Ambulance arrival at scene → Departure from scene → Hospital arrival →
First medical examination (MLC time) → [if death] time of death → Police informed of death →
Postmortem conducted → Postmortem completed → Body handed over → FIR/Panchnama actually recorded →
Chargesheet filed → Vehicle seized → Vehicle released → Court proceedings begin
```

**Checks an expert runs against this chain:**
- **Impossible timing**: any gap that's physically too short (30 seconds between accident and multi-km hospital arrival) or suspiciously too long with no explanation (6 hours between accident and FIR with no medical/logistical reason stated).
- **Out-of-order events**: a document dated/timed BEFORE an event it describes (an FIR "recording" an ambulance's arrival time that is, per the FIR's own timestamp, in the future relative to when the FIR itself was lodged — this happens more often than expected, from clerical error or fabrication).
- **The "informed" vs "recorded" distinction** — General Diary entry time (when police FIRST heard) is often earlier than the formal FIR registration time; a large gap between these two specifically (not just accident-to-FIR) is its own, more precise delay signal that a single "accident to FIR" number collapses and hides.
- **Death timeline cross-check**: PM's stated time-since-death estimate should be broadly consistent with the last-known-alive time from hospital records — a mismatch here is medically significant, not just administrative.
- **Vehicle seizure timing vs. chargesheet timing** — a vehicle "seized" on the accident date but a chargesheet filed many months later with no stated investigation activity in between is worth asking about, especially in cases with an unusually long investigation.
- **Weekday/time-of-day plausibility** — does the claimed accident time match the stated activity (e.g., "going to work at 11 PM" needs a stated reason; not impossible, just needs an explanation the documents should provide).

---

## SECTION 4 — GEOGRAPHIC / SCENE INTELLIGENCE

**Beyond simple geocoding:**
- **Does the claimed route make geographic sense** for the stated origin/destination in witness statements? (E.g., if a witness says "we were going from Village A to Village B," is the accident location actually ON a plausible road between those two points, or wildly off that path?)
- **Road classification consistency** — Panchnama says "national highway," FIR says "village road" — these are different physical realities with different speed/visibility implications, and a mismatch changes how plausible the stated collision dynamics are.
- **Distance-based plausibility, done honestly** — where a system's mapping tier lacks real coordinates and correctly declines to compute exact distances, an expert investigator, lacking a tool, still does this manually: does the STATED hospital make geographic sense as "the nearest reasonable facility," or was the victim taken to a distant hospital for a non-obvious reason (which can be innocent — better facility — or a red flag — a "friendly" hospital known for cooperating with fraudulent claims)?
- **Weather/lighting cross-check against independent, public data** — if the FIR states "heavy rain" at a specific date/time, this is independently checkable against historical weather records — a false weather claim is a subtle but real, checkable fact.
- **Jurisdiction plausibility** (a fact any system should be honest about NOT asserting without real boundary-data access) — but an expert still manually sanity-checks: is the named police station even in a plausible district for the stated accident village? A wildly distant police station handling a "local" accident deserves a question, even without formal boundary data.

---

## SECTION 5 — MEDICAL INTELLIGENCE

- **Injury severity vs. treatment intensity mismatch** — "grievous" injury classification with only outpatient treatment, or "minor" injury with an extended ICU stay, are both worth flagging — severity classification should be internally consistent with the treatment record, not just self-declared.
- **Treatment timeline vs. billing timeline** — medical bills dated OUTSIDE the actual admission-discharge window (billed for days the patient wasn't admitted) is one of the single clearest fraud tells in Indian motor claims, and requires literally just comparing two date ranges — cheap to check, high value.
- **Multiple hospitals for one injury** — a genuine referral chain (small hospital → bigger hospital) is normal and should be traceable via referral notes; an UNEXPLAINED hospital change (no referral note, different city entirely) is worth asking about.
- **Injury consistent with the STATED mechanism** — a "fell from two-wheeler at low speed" claim with injuries consistent with a high-speed impact (or vice versa) is a real medical-forensic contradiction, though this requires either a doctor's opinion or PM findings, not something a document-reading process alone can assess reliably — this is a genuine "needs human medical review" trigger, not something to over-claim algorithmically.
- **Doctor/hospital credential sanity** — is the treating hospital/doctor a real, registered facility? (Fake hospitals/clinics for fabricated claims exist; this needs an external registry cross-check most systems don't currently have.)

---

## SECTION 6 — LEGAL / DOCUMENTARY INTELLIGENCE

- **Section citation accuracy** — do the cited BNS/IPC/MVA sections actually match the FACTS described (e.g., is the death-by-negligence section actually supported by the narrative, or was a lesser/greater section cited inconsistently across FIR vs. Chargesheet)?
- **Chargesheet outcome vs. FIR's original allegation** — did the chargesheet actually SUSTAIN the FIR's sections, downgrade them, or add new ones after investigation? A downgrade (e.g., from a grievous-injury section to a simple-hurt section) is a material fact for liability assessment that a report should explicitly surface, not bury.
- **Court proceeding status** — is there an ongoing MACT case, and if so, has any interim order (interim compensation, for instance) already been passed that affects the insurer's exposure calculation?
- **Signature/thumb-impression authenticity markers** — are all required signatures present on each document (complainant, witnesses, investigating officer, doctor)? A document missing an expected signature is procedurally incomplete, independent of its content being true or false.
- **Document sequence integrity** — page numbering, continuous stamps/seals, no visible gaps — genuinely hard for an automated system to assess without vision analysis, but a real investigator physically checks for this, and its absence should be a named "not independently verifiable" gap, not silently ignored.

---

## SECTION 7 — POLICY / INSURANCE INTELLIGENCE

- **Policy wording vs. vehicle's actual declared use** — beyond simple date-validity, does the POLICY TYPE (private car, commercial goods carrier, passenger carrier) match what's on the RC and what was actually happening at accident time? A mismatch here can be grounds for the insurer's own Section 149(5) recovery rights, not just claim assessment.
- **Add-on covers claimed vs. actually purchased** — was a specific add-on (e.g., zero-depreciation, engine protection) actually part of THIS policy, or is the claim assuming coverage that was never bought?
- **NCB (No Claim Bonus) consistency** — does the declared NCB percentage match what it should be given the insured's actual claims history with this or other insurers? (Real fraud pattern: falsely claiming a high NCB to reduce premium while having an undisclosed claims history.)
- **Nominee/beneficiary consistency** in death claims — does the policy's own nominee match who's actually filing/benefiting from the claim?

---

## SECTION 8 — HUMAN BEHAVIOURAL INTELLIGENCE

This is the domain most experienced investigators develop through years of fieldwork, and the domain most AI-assisted systems touch least:

- **Statement language patterns** — genuine, spontaneous accounts have natural inconsistencies in minor details (exact seconds, exact distances) while remaining consistent in the CORE narrative; overly rehearsed, suspiciously identical accounts across multiple independent witnesses are themselves a signal.
- **Emotional register consistency** — does the tone/detail-level of a statement match the claimed relationship to the victim (a claimed close family member's statement reading as clinically detached, or a claimed stranger's statement reading as unusually intimate/detailed) — genuinely subtle, requires real human judgment, but worth naming as a category investigators DO use.
- **Cooperation patterns** — was the claimant/family prompt and forthcoming with documents, or was there unusual delay/reluctance in producing specific documents (which ones, specifically, matters — reluctance around income proof vs. reluctance around medical records point to different concerns)?
- **Prior claims behavior** — has this claimant, or this family, filed insurance claims before (with any insurer, any policy type)? A pattern of frequent claims is not proof of fraud but is a legitimate risk factor worth naming explicitly.
- **Third-party involvement patterns** — was a claim "arranged" through an unusually proactive intermediary/agent/lawyer who approached the family rather than the reverse? This is a well-known organized-fraud recruitment pattern in Indian MACT claims specifically.

---

## SECTION 9 — DIGITAL EVIDENCE INTELLIGENCE

- **Photograph authenticity and completeness** — not just "were photos taken" (often tracked as a simple boolean) but: do the photos show consistent lighting/weather with the claimed accident time? Do metadata timestamps (where extractable) match the claimed date? Are there suspicious signs of staging (debris arranged too neatly, damage inconsistent with the described impact)?
- **CCTV existence vs. CCTV actually obtained** — a document merely NOTING "CCTV camera present nearby" is different from the footage actually being secured and reviewed; a report should distinguish "CCTV noted as present, not obtained" from "CCTV obtained and reviewed, shows X."
- **Mobile phone/call records** — genuinely underused in Indian motor claims but a real forensic tool: does the claimed "informed by phone" timeline match if call detail records were ever obtained? (Rarely available to an insurance investigator directly, but the ABSENCE of any attempt to obtain them, in a high-value or suspicious case, is itself worth noting as an outstanding verification step.)
- **Digital document tampering signs** — for any digitally-submitted (not physically scanned) document, are there metadata inconsistencies (creation date after the claimed event date, editing software traces)? This is a genuinely new forensic-document-analysis capability most current systems lack entirely, not something a prompt tweak can add.

---

## SECTION 10 — CONTRADICTION TAXONOMY (deepened)

Beyond simply naming a contradiction "exists," an expert investigator classifies it by TYPE, because the type determines what it actually proves:

1. **Clerical/OCR contradiction** — almost certainly a reading error, not a real fact conflict (e.g., one document says "17/03/2025," OCR misread as "07/03/2025" elsewhere). Lowest-weight category.
2. **Transliteration contradiction** — a name/place spelled differently due to script conversion, not a real identity conflict.
3. **Genuine factual contradiction, innocent explanation available** — e.g., two slightly different accident times where one source is "approximate" and clearly labeled as such.
4. **Genuine factual contradiction, no innocent explanation apparent** — the serious category; this is where real investigation effort belongs.
5. **Self-interested contradiction** — a party's own account diverges from independent sources in a direction that benefits them specifically (expected human behavior, worth naming as its own category rather than lumping with #4).
6. **Structural/procedural contradiction** — a document's own internal logic doesn't hold together (e.g., PM's stated cause of death doesn't match its own listed injuries) — this indicates a problem with THAT document's reliability, not necessarily with the underlying facts.

---

## SECTION 11 — DISCREPANCY vs. FRAUD (the reasoning chain)

```
Difference observed
   ↓
Is there an innocent explanation consistent with normal document-handling
(OCR error, transliteration, rounding, clerical delay, regional-office variance)?
   ↓ NO
Is the difference material to LIABILITY, QUANTUM, or POLICY VALIDITY
(vs. a cosmetic detail that doesn't change any conclusion)?
   ↓ YES
Does the difference, combined with OTHER differences in the SAME case,
form a recognizable pattern (see fraud indicator patterns below)
rather than standing alone?
   ↓
Confidence in "fraud-relevant" vs. "genuine but immaterial" vs.
"genuine and material but not fraud-indicative" — three DIFFERENT conclusions,
not a binary fraud/no-fraud call.
```

The critical discipline: **a single difference, however striking, is evidence of a difference — not evidence of fraud.** Fraud conclusions require PATTERNS across multiple independent data points, which is exactly why Section 12 below is about combinations, not isolated flags.

---

## SECTION 12 — FRAUD INDICATOR PATTERNS (combinations, not isolated flags)

Experienced investigators know that isolated red flags are common and mostly innocent; it's the CO-OCCURRENCE of specific combinations that shifts suspicion meaningfully:

- **The "fresh policy" pattern**: policy issued within days of the accident + no prior claims history + high sum insured relative to the insured's apparent means.
- **The "convenient witness" pattern**: all witnesses are family/close associates of the claimant + no independent bystander despite the location being described as busy/populated.
- **The "delayed-but-clean" pattern**: significantly delayed FIR + a suspiciously complete, detailed, internally-consistent narrative (genuine delayed reports from real trauma tend to have MORE gaps and vagueness, not less — an unusually polished delayed account is itself worth noting).
- **The "documentation cascade" pattern**: one missing/inconsistent core document (e.g., no MLC) combined with unusually strong secondary documentation (very detailed bills, very complete claim petition) — the imbalance itself is the signal.
- **The "network" pattern**: same witness names, same investigating officer, same hospital, or same advocate recurring across multiple, otherwise-unrelated claims — extending network detection to witness names, treating doctors, and advocates (beyond vehicle/DL/phone-number matching) catches a materially different fraud ring pattern.
- **The "total loss recycling" pattern**: a vehicle with a prior total-loss/salvage claim reappearing in a new claim.
- **The "substitution" pattern**: multiple, subtly different physical-identity signals for "the driver" or "the injured" across documents (different ages, different addresses, inconsistent physical descriptions) that individually look like normal data-entry variance but collectively suggest more than one real person is being blended into a single claimed identity.

---

## SECTION 13 — MANUAL REVIEW TRIGGERS

An investigator should always escalate to a human reviewer (not attempt automated resolution) when:
- Any single document's authenticity itself is in question (not just its content) — signs of alteration, mismatched fonts/formatting within one document, inconsistent stamps.
- Medical causation is genuinely ambiguous (pre-existing condition vs. accident as the true cause of death).
- The claim value is unusually high relative to the case's document completeness.
- Any fraud-pattern combination (Section 12) reaches 2+ co-occurring signals.
- A witness or party appears in cross-case network flags for an unrelated prior case.
- Legal/jurisdictional questions arise that require an advocate's judgment, not an investigator's.

---

## SECTION 14 — CONFIDENCE FACTORS (the complete list an expert weighs)

Beyond document count and internal consistency:
- **Source document primacy** — an MLC (contemporaneous, clinical) outweighs a Claim Petition (drafted later, by an interested party) on the same fact; confidence should weight WHICH document a fact comes from, not just whether documents agree.
- **Independence of corroboration** — two documents agreeing is weaker evidence than two documents from DIFFERENT, unrelated sources agreeing (police-generated FIR + hospital-generated MLC agreeing is stronger than FIR + Chargesheet agreeing, since the Chargesheet is largely derived FROM the FIR, not independent of it).
- **Investigator's own field verification vs. paper-only assessment** — a confidence score should be able to reflect whether any physical/field verification was ever actually done, versus a purely document-based desk assessment.
- **Time elapsed since the event** — a very old case with all original witnesses no longer traceable carries inherently lower achievable confidence, independent of document quality.

---

## Closing note

This is a first, substantial draft — deep in most places, but knowledge work of this kind never truly reaches a final state. Treat it as a living reference: extend individual sections as specific cases surface gaps, rather than treating any section above as closed. The natural next step, when wanted, is translating selected pieces of this into concrete module/prompt/report design — that is a separate, deliberate decision and is explicitly out of scope for this document.
