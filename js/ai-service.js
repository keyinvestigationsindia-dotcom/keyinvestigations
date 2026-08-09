// ============================================================
// KEY Investigations – AI Service Layer
// Single entry point for all Bima Anveshak AI Engine communication.
// UI components call AIService.<method>(...) only — they never see
// endpoints, prompts, auth tokens, or retry logic directly.
// ============================================================

const AI_ENGINE_BASE_URL = "https://bima-ai-service.onrender.com";

// ── Transport ──
let _aiQueue = Promise.resolve();
function _runQueued(fn, onStatus) {
  const run = async () => { try { return await fn(); } finally { if (onStatus) onStatus(null); } };
  const queued = _aiQueue.then(run, run);
  _aiQueue = queued.catch(() => {});
  return queued;
}

async function _request(endpoint, body, { maxRetries = 4, onStatus } = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; throw new Error("Session expired"); }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(AI_ENGINE_BASE_URL + endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + session.access_token,
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      window.location.href = 'login.html';
      throw new Error("Session expired — please log in again.");
    }
    if ((response.status === 429 || response.status === 529 || response.status === 503) && attempt < maxRetries) {
      const wait = Math.min(2000 * Math.pow(2, attempt), 16000);
      if (onStatus) onStatus(`Server busy, retrying in ${Math.round(wait / 1000)}s… (${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return response;
  }
}

async function _describeFailedResponse(response) {
  const errBody = await response.text().catch(() => "");
  if (/^\s*<!doctype html/i.test(errBody) || /^\s*<html/i.test(errBody))
    return `Request failed (${response.status}) — upload may be too large. Try fewer pages/files.`;
  return `API error ${response.status}: ${errBody.slice(0, 200) || "no details"}`;
}

async function _parseJsonContent(response, { maxTokensMessage } = {}) {
  if (!response.ok) throw new Error(await _describeFailedResponse(response));
  const data = await response.json();
  if (!data.content) throw new Error("Unexpected response from AI service.");
  if (maxTokensMessage && data.stop_reason === "max_tokens") throw new Error(maxTokensMessage);
  return JSON.parse(data.content.replace(/```json|```/g, "").trim());
}

// ── File → AI payload conversion ──
let _pdfjs = null;
async function _loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load PDF reader library"));
      document.head.appendChild(script);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  _pdfjs = window.pdfjsLib;
  return window.pdfjsLib;
}

async function _pdfFileToImages(file) {
  const pdfjsLib = await _loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images = [];
  const maxPages = Math.min(pdf.numPages, 20);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.3 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    images.push({ mediaType: "image/jpeg", data: dataUrl.split(",")[1] });
  }
  return images;
}

let _mammoth = null;
async function _loadMammoth() {
  if (_mammoth) return _mammoth;
  if (!window.mammoth) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.7.2/mammoth.browser.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load Word document reader library"));
      document.head.appendChild(script);
    });
  }
  _mammoth = window.mammoth;
  return window.mammoth;
}

async function _docxFileToText(file) {
  const mammoth = await _loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value || "";
}

async function _fileToOptimizedBase64(file) {
  const MAX_DIMENSION = 1300;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });
  let { width, height } = img;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    width = Math.round(width * ratio); height = Math.round(height * ratio);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, width, height);
  const resizedDataUrl = canvas.toDataURL("image/jpeg", 0.72);
  return { mediaType: "image/jpeg", data: resizedDataUrl.split(",")[1] };
}

async function _filesToPayload(files) {
  const images = []; const texts = [];
  for (const file of Array.from(files || [])) {
    const isDocx = file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.name.toLowerCase().endsWith(".docx");
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      images.push(...(await _pdfFileToImages(file)));
    } else if (isDocx) {
      const text = await _docxFileToText(file);
      if (text.trim()) texts.push(`--- ${file.name} ---\n${text.trim()}`);
    } else if (file.type.startsWith("image/")) {
      images.push(await _fileToOptimizedBase64(file));
    } else {
      throw new Error(`"${file.name}" isn't supported. Upload JPG/PNG/PDF/DOCX.`);
    }
  }
  if (images.length > 20) throw new Error("Upload at most 20 pages/files at a time.");
  const approxTotalKB = images.reduce((sum, img) => sum + img.data.length * 0.75, 0) / 1024;
  if (approxTotalKB > 18000) throw new Error(`Files too large (~${Math.round(approxTotalKB / 1024)}MB). Try fewer pages.`);
  const textBlock = texts.length ? `\n\nADDITIONAL TEXT FROM UPLOADED WORD DOCUMENT(S):\n${texts.join("\n\n")}` : "";
  return { images, textBlock };
}

// ── Prompt construction (all AI prompt engineering lives here, not in the UI) ──
function _buildDocumentAutoFillPrompt(category, textBlock) {
  const fieldList = category.fields.map((f) => `"${f.key}": "${f.label}"`).join(", ");
  const analysisHintBlock = category.analysisHint ? `\n\nSPECIAL INSTRUCTIONS FOR THIS CATEGORY:\n${category.analysisHint}` : "";
  return `You are reading scanned insurance investigation document page(s) and/or Word document text (FIR / panchnama / postmortem / statement / vehicle document etc.) for the category "${category.title}". Multiple images may represent multiple pages of the same document, or multiple separate documents of the same category — read all of them together as one source, along with any Word document text provided below. The text may be in any major Indian language — Hindi, Gujarati, Marathi, Tamil, Telugu, Kannada, Malayalam, Bengali, Punjabi, Odia, Assamese, Urdu — or English, or a mix of these.

Read the image(s) and text carefully, identify the language(s) used, and extract the following fields, translating everything into English:
{ ${fieldList}, "_identitySignals": { "name": "person's name, if this document names one", "age": "age, if stated", "sex": "sex/gender, if stated", "uhid": "hospital UHID / patient ID, if stated", "caseNo": "case, CR, or MLC number, if stated", "opdNo": "OPD number, if stated", "hospitalIdentifier": "hospital/clinic name or registration identifier this document is associated with, if stated" }, "_documentCountEstimate": "your best count of how many DISTINCT source documents (not pages) this image set actually appears to contain, as a plain number string, e.g. \"1\"" }
${analysisHintBlock}

Rules:
- Return ONLY a JSON object with exactly these keys (the fields above, plus "_identitySignals" and "_documentCountEstimate"), nothing else (no markdown fences, no preamble).
- For each field, put the relevant extracted/translated information as a string.
- If a field's information is not visible or not present anywhere, set it to an empty string "" — do NOT guess.
- For narrative/long text fields, summarize in formal English, faithful to the source.
- If images are unreadable or blank and no text is provided, return all fields as empty strings.
- "_identitySignals" is separate from the fields above and applies regardless of category: fill in only the sub-fields this specific document actually states about a named person (most documents will leave most or all of these blank — that is expected and correct, not a failure). Follow the exact same no-guessing discipline as every other field, including using "Unclear / requires human verification" for a sub-field you can see is attempted but cannot reliably read, rather than your best guess.
- "_documentCountEstimate" is usually "1" — a single document, however many pages it spans. Only give a higher number if you can genuinely see multiple different document types/formats/letterheads/layouts mixed together in this image set (e.g. a hospital discharge card followed by several separate pharmacy cash memos). Do not guess a number; if you are not sure, say "1".
- CRITICAL — do not normalize illegible handwriting into a confident value. A name, diagnosis, number, or other key fact you are genuinely not confident you read correctly (as opposed to text that is merely in unfamiliar handwriting but plainly says one thing) must be written as "Unclear / requires human verification" — never your best guess at what it "probably" says, and never a plausible-sounding value you completed from partial strokes. This applies especially to medical diagnoses, proper names, and identification numbers, where a wrong confident guess is far more harmful than an honest "unclear." It is always acceptable, and preferred, to extract a shorter but fully-supported answer over a longer confident-sounding one you are not sure of.
- If a field's value is contradicted elsewhere in the SAME image set (e.g. the images clearly reflect two different admission dates for what should be one stay), do not silently pick one — write both values plainly in the field, e.g. "13/8/16 per [X]; 18/8/16 per [Y]" rather than choosing.
- If the provided images/pages appear to contain more than one distinct source document (e.g. a hospital record together with separate pharmacy bills, or two unrelated forms), do not blend them into a single invented narrative or attribute one document's details to another. Extract only what genuinely belongs to each field from whichever page(s) actually support it, and if you notice the set spans multiple distinct document types, say so briefly at the start of the "narrative" field (or the first long-text field, if there is no "narrative" field) rather than silently merging them.
- For narrative/long text fields, where practical, briefly note which page or image the information came from (e.g. "(page 2)") so the value can be traced back to its source — do not do this for short single-fact fields (dates, names, numbers) where it would just add clutter.${textBlock}`;
}

function _buildHeaderAutoFillPrompt(textBlock) {
  return `You are reading insurance claim document(s) — could be a claim intimation letter, policy copy, RC, petition, or FIR — possibly in any major Indian language or English. Extract the following case-level fields, translating into English:
{
  "claimType": "one of exactly: 'MACT Death Claim', 'MACT Injury Claim', 'TPPD Claim', 'Health Claim'. Empty string if unclear.",
  "claimNo": "MACT/claim number",
  "court": "court / jurisdiction",
  "claimAmount": "claim amount as stated",
  "doa": "date of accident",
  "ivVehicle": "insured vehicle type, number and registration",
  "insured": "name of the insured",
  "policyNo": "policy number",
  "policyPeriod": "policy period (from-to dates)"
}
Rules:
- Return ONLY this JSON object.
- If a field isn't visible, set it to "" — do NOT guess.
- Keep values concise.${textBlock}`;
}

// Health Claim reports must not carry motor/MACT assumptions (FIR, panchnama, DAR,
// vehicle/DL/permit/fitness investigation) — those documents are not part of a health
// claim and their "absence" is not evidence of anything. This block is used ONLY when
// claimType === "Health Claim"; the MACT/TPPD observations structure and redFlags rules
// below are unchanged from before this existed. Also carries the uncertainty-preservation
// and identity-cross-check discipline requested for Health Claim reports specifically —
// MACT/TPPD already have their own equivalent (the "particulars" category's age/DOB
// cross-check, redFlags rule 1) and are deliberately left untouched.
const _HEALTH_CLAIM_OBSERVATIONS_GUIDE = `   (a) Introduction & assignment: Who assigned, reference, purpose of investigation.
   (b) Claim & policy verification: Policy number, period, sum insured, and whether the claim intimation/documents are complete — with exact values inline.
   (c) Medical documentation review: Hospital(s)/clinic(s), admission and discharge dates, chronological course of treatment, as recorded across every medical document supplied — all inline.
   (d) Patient/claimant identity: Before stating identity, check every source document section below that names the patient (name, age, sex, UHID, case/CR number, OPD number). If they agree, state the identity once, plainly. If they disagree — including if only one document differs from the rest — do NOT silently choose the value that seems more complete or official; state the exact conflicting values and which document each came from, and note that this requires human verification before the identity is treated as settled.
   (e) Diagnosis, treatment & clinical findings: Diagnosis, treatment given, and clinical findings, drawn from hospital records, OPD records, and investigation reports, chronologically, with dates inline. If any source value was itself recorded as "Unclear / requires human verification" (or similar), state plainly that this specific detail could not be reliably read from the source — never restate it as a confirmed diagnosis or fact, and never substitute your own guess for it.
   (f) Billing & pharmacy review: Medical bills and pharmacy/cash memo records supplied — hospital/pharmacy name, dates, amounts, and whether the billed items are consistent with the treatment documented elsewhere — all inline. If pharmacy/cash memo documents were supplied, they must be reflected here, not omitted.
   (g) Document completeness: Which of the ordinarily-expected health-claim documents (policy copy, discharge summary, medical bills, identity proof, disability certificate if applicable) are present versus absent from what was supplied — note exactly what is missing, without implying anything about documents (like FIR or police records) that are not ordinarily part of a health claim in the first place.
   (h) Discrepancies, uncertainties & red flags: Distinguish, in the narrative, between (i) a genuine discrepancy where two source documents state conflicting facts about the same event, and (ii) a value the extraction itself flagged as uncertain or illegible. A poorly-legible document or an "Unclear / requires human verification" value is NOT, by itself, evidence of claimant fraud or document fabrication — only a discrepancy the source documents themselves actually support should be raised as a concern.
   The observations must read as one continuous, authoritative investigation narrative — not as disconnected paragraphs. Each paragraph must flow into the next with proper transitions. Do not discuss FIR, panchnama, DAR, spot inspection, vehicle registration/permit/fitness, driving licence, or police chargesheet — these are not part of a health claim and must not be treated as missing or suspicious.`;

const _MOTOR_OBSERVATIONS_GUIDE = `   (a) Introduction & assignment: Who assigned, reference, purpose of investigation.
   (b) Accident circumstances: Complete reconstruction from FIR, panchnama, DAR — with exact location, date/time, vehicles, sequence of events, all inline.
   (c) Scene of accident / spot details: What was found at the spot, road conditions, evidence.
   (d) Victim/deceased/injured particulars: Full identity with cross-document age/DOB comparison inline.
   (e) Medical / cause of death / injuries: Hospital, admission, treatment, MLC findings, PM findings — all chronological with dates inline.
   (f) Statements analysis: What each witness/insured/driver/claimant said — with critical analysis of who actually saw vs who arrived later, contradictions noted inline.
   (g) Vehicle & document verification: IV and TP vehicle details, RC, permit, fitness, DL, policy — each verified with validity dates inline, any gaps or mismatches noted immediately.
   (h) Police/legal proceedings: FIR, chargesheet, sections applied — all inline.
   (i) Discrepancies & red flags: Woven into the narrative where they naturally arise, not as a separate list.
   The observations must read as one continuous, authoritative investigation narrative — not as disconnected paragraphs. Each paragraph must flow into the next with proper transitions.`;

const _HEALTH_CLAIM_REDFLAG_RULES = `(1) Diagnosis/treatment consistency — does the diagnosis recorded in one document match the treatment/medication actually given in another document for the same admission/episode; cite exact values from each source
(2) Billing vs. treatment alignment — do the medical bills/pharmacy purchases correspond to the treatment actually documented (dates, hospital/pharmacy, nature of treatment)
(3) Admission/discharge date consistency across ALL medical documents describing the same episode — cite the exact dates and which document each came from
(4) Missing critical claim documents — note exactly what is absent (policy copy, discharge summary, bills, identity proof)
(5) Identity consistency — name/age/sex/ID numbers, across every document that states them; do NOT raise this based on a single field the extraction itself marked uncertain — only when two or more clearly-stated source values genuinely disagree
(6) Treatment timeline gaps — an unexplained gap between the recorded illness/injury onset and first medical attention, only where the source dates actually support this
(7) Cost reasonableness — only if the source documents themselves give a basis for comparison (e.g. differing amounts for the same described item across bills); never invent an external benchmark
Empty array ONLY if genuinely nothing found. Never include an item here whose only basis is a document being hard to read, a translation choice, or a value already marked uncertain in the source data — that is an extraction-quality note, not a claimant/document red flag.`;

const _MOTOR_REDFLAG_RULES = `(1) Age/DOB mismatches across ANY documents — cite exact values from each source
(2) Vehicle number mismatches or formatting differences across documents
(3) Income discrepancies between petition, statement, and proof
(4) Missing critical documents — note exactly what is absent
(5) FIR delay — calculate exact days between accident and FIR, note if explanation given
(6) Conflicting statements — who contradicts whom, on what specific point
(7) Pending/missing chargesheet
(8) Policy validity gaps — check if accident date falls within policy period
(9) DL validity/class mismatch — check authorization vs vehicle driven
(10) Permit/fitness expiry — check if valid on date of accident
(11) Witness credibility — anyone who claims to be eyewitness but description suggests arrived later
(12) Medical timeline gaps — delay between accident and hospital admission
Empty array ONLY if genuinely nothing found.`;

function _buildReportPrompt({ caseData, docsText, sectionKeys, extraNotes, identityConflicts }) {
  const isHealthClaim = caseData.claimType === "Health Claim";
  const observationsGuide = isHealthClaim ? _HEALTH_CLAIM_OBSERVATIONS_GUIDE : _MOTOR_OBSERVATIONS_GUIDE;
  const redFlagRules = isHealthClaim ? _HEALTH_CLAIM_REDFLAG_RULES : _MOTOR_REDFLAG_RULES;
  const factPreservationNote = isHealthClaim ? `

HEALTH CLAIM — ADDITIONAL FACT-HANDLING RULES:
When writing this report, distinguish four kinds of information at all times:
(A) A source-supported fact — state it plainly.
(B) A source-supported but uncertain value (e.g. a field the source data marks "Unclear / requires human verification") — state plainly that this specific detail could not be reliably read from the source; do NOT present it as a confirmed diagnosis or fact, and do NOT substitute your own guess for it.
(C) A genuine discrepancy between two source documents describing what should be the same fact (e.g. two different admission dates for one stay) — state both values and which document each came from, and note it requires human review; do NOT silently pick one, and do NOT treat the discrepancy by itself as evidence of fraud.
(D) Information the supplied documents simply do not contain — state that it is not available; never fabricate a plausible-sounding substitute.` : "";
  // Identity conflicts are computed deterministically by the caller (report.html's
  // detectIdentityConflicts, comparing each category's own _identitySignals) BEFORE
  // this prompt is built — the model is never asked to notice these itself, only to
  // transcribe an already-verified list faithfully. Empty when no conflict exists, or
  // for non-Health-Claim reports (identityConflicts is only ever computed for Health
  // Claim in report.html today).
  const identityConflictsBlock = (isHealthClaim && Array.isArray(identityConflicts) && identityConflicts.length > 0) ? `

IDENTITY CONFLICTS DETECTED BY THE SYSTEM (not for you to find — these were already compared field-by-field across the source documents before you received this prompt; you must report every one of them in the "Patient/claimant identity" part of the observations, exactly as listed, and must NOT silently resolve any of them to a single value):
${identityConflicts.map((c) => `- ${c.field}: ${c.values.map((v) => `"${v.value}" (per ${v.sources.join(", ")})`).join(" vs. ")}`).join("\n")}` : "";
  return `You are a senior insurance investigation report writer with 20+ years of MACT (Motor Accident Claims Tribunal), insurance fraud investigation, and legal-expert experience in India. You write exactly like a seasoned field investigator reporting to an insurance company — formal, authoritative, dense with inline facts, third-person voice throughout.

WRITING STYLE (match this precisely):
- Write as a 20-year veteran investigator and legal expert would — authoritative, precise, every sentence loaded with inline factual details (names, dates in DD/MM/YYYY, FIR numbers, vehicle numbers, policy numbers, legal sections — all woven naturally into the narrative, never in separate bullet points within observations).
- Use formal Indian investigation-report English: "The undersigned has conducted...", "As per the version of Shri [Name] S/o [Father] R/o [Address]...", "It has been ascertained that...", "On verification, it was found that...", "Perusal of the documents reveals...", "During the course of investigation...", "The factum of accident stands established...".
- Every person mentioned must include full identification inline: "Shri Ramesh Kumar S/o Shri Suresh Kumar, aged about 45 years, R/o Village Kheralu, Taluka Kheralu, District Mehsana, Gujarat".
- Every vehicle reference must include full details inline: "Truck bearing registration no. GJ-02-AX-1234 (Tata LPT 1613, laden with goods)".
- Every date must be in DD/MM/YYYY format inline: "the accident occurred on 15/03/2024 at approximately 14:30 hours on NH-48 near Kheralu Chowkpati".
- Every legal reference must cite exact sections inline: "FIR No. 123/2024 dated 15/03/2024 registered at Kheralu Police Station u/s 279, 337, 338 of IPC (now BNS 281, 289, 290)".

ABSOLUTE FACT PRESERVATION RULES:
- NEVER alter, round, paraphrase, or approximate any factual element from the source data: names, dates, times, FIR numbers, vehicle numbers, policy numbers, registration numbers, legal sections, monetary values, addresses, ages, or any identifier.
- Copy every factual detail EXACTLY as provided in the source fields — character for character.
- If a date is "15/03/2024", write "15/03/2024" — never "March 2024" or "15th March 2024".
- If a vehicle number is "GJ-02-AX-1234", write exactly that — never reformat or abbreviate.
- If income is stated as "Rs. 15,000/- per month", write exactly that — never round to "approximately Rs. 15,000/-".
- You may ONLY improve grammar, sentence flow, readability, and professional language. Zero factual drift.${factPreservationNote}${identityConflictsBlock}

REPORT STRUCTURE:
1. "sections" — Each document category gets a DETAILED factual brief (3-6 sentences), written in formal investigative language with ALL factual details inline. Not a summary — a comprehensive factual extract written like a professional investigator's notes.
2. "findings" — A structured, numbered list of KEY established facts drawn from ALL documents. Each finding must be a complete, self-contained factual statement with all identifiers inline. Group logically: ${isHealthClaim ? "(a) Claim/policy facts (b) Patient identity details (c) Diagnosis & treatment findings (d) Billing & pharmacy facts (e) Document completeness (f) Discrepancies noted" : "(a) Accident facts (b) Victim/injured details (c) Vehicle & document verification (d) Statement analysis (e) Medical/cause findings (f) Discrepancies noted"}.
3. "observations" — This is the MAIN body of the report. Write a DETAILED, CHRONOLOGICAL narrative (minimum 800 words for a complete case) structured as follows:
${observationsGuide}
4. "conclusion" — A comprehensive closing assessment (4-8 sentences) with clear determination on: ${isHealthClaim ? "(a) whether the claim documentation is consistent and complete (b) document compliance status (c) any patient-identity or cross-document discrepancies requiring human verification before the claim is decided (d) any recommendations for the insurer. Do not characterise the claim as an accident claim, and do not conclude anything about whether an accident occurred — that is outside the scope of a health claim's medical documentation." : "(a) whether the accident is genuine/staged (b) liability assessment (c) document compliance status (d) any recommendations for the insurer."}

Produce a JSON object (nothing else) with this shape:
{
  "sections": {
    ${sectionKeys ? sectionKeys.split(", ").map(k => `"${k}": "DETAILED factual brief (3-6 sentences, all facts inline)"`).join(",\n    ") : '"none": "no categories selected"'}
  },
  "redFlags": [
    {"flag": "title", "detail": "detailed explanation with exact mismatched values cited", "severity": "high|medium|low"}
  ],
  "findings": "numbered list (\\n between items, prefix with '1. ', '2. ' etc.), grouped by category",
  "observations": "${isHealthClaim ? "DETAILED chronological narrative (minimum 800 words), formal investigative language, every fact inline, sequence: claim/policy → patient identity → diagnosis/treatment → billing/pharmacy → document completeness → discrepancies" : "DETAILED chronological narrative (minimum 800 words), formal investigative language, every fact inline, sequence: accident → victim → medical → statements → documents → discrepancies"}",
  "conclusion": "comprehensive 4-8 sentence closing assessment with determination and recommendations"
}

Rules for redFlags (be thorough — a senior investigator catches everything):
${redFlagRules}

CASE HEADER:
Claim Type: ${caseData.claimType}
Claim No: ${caseData.claimNo}
Court: ${caseData.court}
Claim Amount: ${caseData.claimAmount}${isHealthClaim ? "" : `
Date of Accident: ${caseData.doa}
Insured Vehicle: ${caseData.ivVehicle}`}
Insured: ${caseData.insured}
Policy No: ${caseData.policyNo} (${caseData.policyPeriod})

SOURCE DOCUMENTS PROVIDED:
${docsText || "(none selected/filled)"}

INVESTIGATOR NOTES:
${extraNotes || "(none)"}`;
}

function _buildDiagramPrompt(accidentText) {
  return `Based only on the accident facts below, produce a SIMPLE TOP-DOWN SCHEMATIC DIAGRAM as structured JSON. Return ONLY JSON in this shape:
{
  "roadDescription": "short road label",
  "roadOrientation": "horizontal" or "vertical",
  "vehicles": [{"label":"vehicle label","position":"number 0-100","lane":"near" or "far","direction":"left|right|up|down","role":"striking|struck|other"}],
  "impactPoint": "number 0-100 or null",
  "notes": "short factual caption, max 15 words",
  "confidence": "high|medium|low"
}

ACCIDENT FACTS:\n${accidentText}`;
}

// ── Legal & Investigation Intelligence — shared contract (frozen v1.1, 2026-07-19) ──
// Three-layer plug-in architecture:
//   Layer 1 (registry)  — public.legal_intelligence_modules in Supabase. The catalog
//                         of which modules exist. Shared by KEY Investigations and the
//                         Bima Anveshak AI Engine via the same project. Adding a future
//                         module (Voice Intelligence, OSINT Intelligence, etc.) is one
//                         INSERT into that table — no file edit, no deploy, either repo.
//   Layer 2 (data)      — the ModuleRecord array below, stored in
//                         report_drafts.legal_intelligence (jsonb). Changes per report.
//   Layer 3 (renderer)  — ModuleCard / LegalIntelligenceSection / the export functions
//                         in report.html. Reads Layer 2 generically; never touches
//                         Layer 1 or hardcodes a module name. Never changes when Layer 1
//                         gains a row.
// Nothing behind this is implemented yet — every module resolves as a placeholder
// until a real backend exists.
const LEGAL_INTELLIGENCE_SCHEMA_VERSION = "1.1.0";

// One record per module — every field below is part of the shared contract.
// status is one of exactly: "Completed" | "Pending Verification" | "Not Performed" |
// "Not Applicable". manualReview/verifiedBy record who moved a module from Pending to
// Completed; they are not a second status system.
// evidence items are { label, kind, url|fileRef } — kind is one of "document" | "image" |
// "audio" | "video" | "map" | "link", defaulting to "document" when absent. Additive:
// existing stored records with no kind on their evidence items remain valid as-is.
function _emptyModuleRecord(moduleId, moduleLabel) {
  return {
    moduleId, moduleLabel,
    status: "Not Performed",
    summary: null,
    details: null,
    confidence: null,   // "high" | "medium" | "low" | null
    source: null,       // e.g. "Bima Anveshak AI Engine — eCourts Connector v1"
    asOf: null,         // ISO date the underlying data was valid/fetched
    verifiedBy: null,   // investigator/QC name once manually reviewed
    manualReview: false,
    evidence: [],       // [{ label, kind, url|fileRef }]
    references: [],     // citation / case-number strings
    lastUpdated: new Date().toISOString(),
    version: 1,
  };
}

// Reads the Layer 1 registry table. Returns [] (never throws) if the table is
// unreachable — a registry hiccup degrades to "no modules shown," not a crash.
async function _fetchModuleRegistry() {
  try {
    const { data, error } = await sb
      .from("legal_intelligence_modules")
      .select("module_id, module_label")
      .eq("enabled", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error("Failed to load legal_intelligence_modules registry:", e);
    return [];
  }
}

// ── Module implementations (Layer 2 compute — one function per module, fully independent) ──
// getLegalIntelligence() dispatches to these by module_id. A module with no entry here still
// resolves as a placeholder ("Not Performed") — this is exactly the seam future modules plug
// into, one at a time, without touching the registry, the renderer, or any other module.

function _buildTimelineIntelligencePrompt(docsText) {
  return `You are reconstructing a chronological timeline for an Indian motor insurance (MACT) investigation, purely for internal cross-checking — you are not a legal or medical authority.

From the case document text below, extract every explicitly dated event — this may include an accident, FIR lodging, panchnama, admission/discharge, OPD visit, investigation/test, postmortem, death, chargesheet, pharmacy/medicine purchase, or any other dated event actually present in the text — and:
1. List them in chronological order.
2. Flag any sequence that is impossible or inconsistent (e.g. a document dated before the event it describes, a death certificate dated before the postmortem, an FIR lodged before the stated accident time) — only flag what the text actually supports, do not speculate.
3. If a document's date is missing or unclear, say so rather than guessing.

Respond with ONLY this JSON shape, no other text:
{
  "events": [{"date": "as written in source, do not reformat", "event": "short label", "source": "which document"}],
  "anomalies": [{"description": "plain-language explanation", "severity": "high|medium|low"}],
  "confidence": "high|medium|low"
}

CASE DOCUMENTS:
${docsText}`;
}

// Returns just the content fields — getLegalIntelligence() merges in moduleId/moduleLabel
// from the registry row, so this function doesn't need to know its own identity.
async function _computeTimelineIntelligence({ docsText }, { onStatus } = {}) {
  const prompt = _buildTimelineIntelligencePrompt(docsText);
  const response = await _runQueued(() => _request("/ki/completion", {
    prompt, max_tokens: 2000, model_tier: "fast",
  }, { onStatus }), onStatus);
  const parsed = await _parseJsonContent(response, { maxTokensMessage: "Timeline too long — try including fewer documents." });
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid timeline response shape");

  // Defensive: an off-spec AI response (wrong type, missing keys) degrades to "no
  // events found" rather than throwing — a malformed response should never crash
  // the module dispatch loop above this.
  const events = Array.isArray(parsed.events) ? parsed.events : [];
  const anomalies = Array.isArray(parsed.anomalies) ? parsed.anomalies : [];
  const eventLines = events.map((e) => `${e.date || "(date unclear)"} — ${e.event || "unlabeled event"} (${e.source || "source not stated"})`).join("\n");
  const anomalyLines = anomalies.map((a) => `[${(a.severity || "").toUpperCase()}] ${a.description}`).join("\n");
  const summary = events.length === 0
    ? "No dated events found in the provided documents."
    : anomalies.length
      ? `${events.length} dated event${events.length === 1 ? "" : "s"} reconstructed; ${anomalies.length} inconsistenc${anomalies.length === 1 ? "y" : "ies"} flagged.`
      : `${events.length} dated event${events.length === 1 ? "" : "s"} reconstructed; no inconsistencies flagged.`;
  // Which source documents actually contributed a dated event — a real, non-fabricated
  // cross-reference back to what was fed in.
  const references = [...new Set(events.map((e) => e.source).filter(Boolean))];

  return {
    // Not "Completed" — this is fresh AI output nobody has reviewed yet. Only a human
    // marking it reviewed (manualReview/verifiedBy) should ever move it to Completed.
    status: "Pending Verification",
    summary,
    details: [eventLines, anomalyLines].filter(Boolean).join("\n\n") || null,
    confidence: parsed.confidence || null,
    source: "AI-extracted from uploaded case documents",
    asOf: new Date().toISOString(),
    verifiedBy: null,
    manualReview: false,
    evidence: [],
    references,
    lastUpdated: new Date().toISOString(),
    version: 1,
  };
}

// Shared by every module that follows the "cross-check documents, flag discrepancies"
// shape (Vehicle, Person, Medical, Digital Evidence — anything that isn't a timeline).
// One parser/formatter, reused rather than duplicated per module.
async function _computeChecksAndDiscrepancies(promptBuilder, docsText, { emptyMessage, tooLongMessage, onStatus } = {}) {
  const prompt = promptBuilder(docsText);
  const response = await _runQueued(() => _request("/ki/completion", {
    prompt, max_tokens: 2000, model_tier: "fast",
  }, { onStatus }), onStatus);
  const parsed = await _parseJsonContent(response, { maxTokensMessage: tooLongMessage });
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid response shape");

  const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
  const discrepancies = Array.isArray(parsed.discrepancies) ? parsed.discrepancies : [];
  const checkLines = checks.map((c) => `${c.item || "check"}: ${c.result || "(no result stated)"} (${c.source || "source not stated"})`).join("\n");
  const discrepancyLines = discrepancies.map((d) => `[${(d.severity || "").toUpperCase()}] ${d.description} (${d.source || "source not stated"})`).join("\n");
  const summary = (checks.length === 0 && discrepancies.length === 0)
    ? emptyMessage
    : discrepancies.length
      ? `${checks.length} cross-check${checks.length === 1 ? "" : "s"} performed; ${discrepancies.length} discrepanc${discrepancies.length === 1 ? "y" : "ies"} flagged.`
      : `${checks.length} cross-check${checks.length === 1 ? "" : "s"} performed; no discrepancies flagged.`;
  // Which source documents actually contributed a check or discrepancy — a real,
  // non-fabricated cross-reference back to what was fed in.
  const references = [...new Set([...checks.map((c) => c.source), ...discrepancies.map((d) => d.source)].filter(Boolean))];

  return {
    // Not "Completed" — this is fresh AI output nobody has reviewed yet. Only a human
    // marking it reviewed (manualReview/verifiedBy) should ever move it to Completed.
    status: "Pending Verification",
    summary,
    details: [checkLines, discrepancyLines].filter(Boolean).join("\n\n") || null,
    confidence: parsed.confidence || null,
    source: "AI-extracted from uploaded case documents",
    asOf: new Date().toISOString(),
    verifiedBy: null,
    manualReview: false,
    evidence: [],
    references,
    lastUpdated: new Date().toISOString(),
    version: 1,
  };
}

function _buildVehicleIntelligencePrompt(docsText) {
  return `You are cross-verifying vehicle-related facts for an Indian motor insurance (MACT) investigation, purely for internal cross-checking — you are not a legal authority and have no access to any external registry (VAHAN, RTO, etc.); you can only compare what the provided text itself states.

From the case document text below — which may include RC, Permit, Fitness Certificate, Insurance Policy, MVI/Mechanical Inspection Report, TP Vehicle Details, Spot Panchnama, FIR, and Chargesheet — cross-check vehicle facts such as: registration number, owner name, permit type/validity, fitness certificate validity, insurance policy period/coverage, and vehicle description, wherever two or more documents mention the same vehicle.

1. List each cross-check you can actually perform from the text given (e.g. "registration number as per FIR vs. RC").
2. Flag any discrepancy the text actually supports (e.g. registration number differs between two documents, permit or fitness certificate expired before the accident date, policy period doesn't cover the accident date) — only flag what is explicitly stated, never infer or guess a value that isn't written.
3. If a relevant document isn't present in the text, or a fact isn't stated, say so rather than assuming a value.
4. Every check and every discrepancy must name which document(s) it came from.

Respond with ONLY this JSON shape, no other text:
{
  "checks": [{"item": "what was cross-checked", "result": "what was found, stated plainly", "source": "which document(s)"}],
  "discrepancies": [{"description": "plain-language explanation", "severity": "high|medium|low", "source": "which document(s)"}],
  "confidence": "high|medium|low"
}

CASE DOCUMENTS:
${docsText}`;
}

async function _computeVehicleIntelligence({ docsText }, { onStatus } = {}) {
  return _computeChecksAndDiscrepancies(_buildVehicleIntelligencePrompt, docsText, {
    emptyMessage: "No vehicle-related documents found to cross-check.",
    tooLongMessage: "Vehicle cross-check too long — try including fewer documents.",
    onStatus,
  });
}

function _buildPersonIntelligencePrompt(docsText) {
  return `You are cross-verifying the identity and personal particulars of the parties (deceased/injured, claimant, dependents) for an Indian motor insurance (MACT) investigation, purely for internal cross-checking — you are not an identity verification authority and have no access to any external database (Aadhar/UIDAI, etc.); you can only compare what the provided text itself states.

From the case document text below — which may include Particulars of Deceased/Injured, Age Proof Documents, Income Proof & Employment Details, Marriage/Dependency Proof, Insured Statement, Driver Statement, Claimant Statement(s), and 161 Eyewitness Statements — cross-check personal particulars (name, age/DOB, address, occupation, relationship to deceased/injured) wherever the same person is referenced in two or more documents.

1. List each cross-check you can actually perform from the text given (e.g. "age of deceased as per Petition vs. Age Proof").
2. Flag any discrepancy the text actually supports (e.g. name spelled differently, age/DOB differs, address inconsistent, a claimed dependent/relation not corroborated elsewhere) — only flag what is explicitly stated, never infer or guess a value that isn't written.
3. If a relevant document isn't present in the text, or a fact isn't stated, say so rather than assuming a value.
4. Every check and every discrepancy must name which document(s) it came from.

Respond with ONLY this JSON shape, no other text:
{
  "checks": [{"item": "what was cross-checked", "result": "what was found, stated plainly", "source": "which document(s)"}],
  "discrepancies": [{"description": "plain-language explanation", "severity": "high|medium|low", "source": "which document(s)"}],
  "confidence": "high|medium|low"
}

CASE DOCUMENTS:
${docsText}`;
}

async function _computePersonIntelligence({ docsText }, { onStatus } = {}) {
  return _computeChecksAndDiscrepancies(_buildPersonIntelligencePrompt, docsText, {
    emptyMessage: "No party-identity documents found to cross-check.",
    tooLongMessage: "Person cross-check too long — try including fewer documents.",
    onStatus,
  });
}

function _buildMedicalIntelligencePrompt(docsText) {
  return `You are cross-checking medical DOCUMENTATION consistency for an Indian motor insurance (MACT) investigation, purely for internal cross-checking. You are not a doctor, cannot assess whether treatment was clinically appropriate, and must never offer a medical opinion — only check whether the documents agree with each other on stated facts (dates, diagnosis wording, amounts, percentages).

From the case document text below — which may include MLC & Medical/Injury Details, Discharge Summary, Medical Bills & Expenses, Disability Certificate, and Postmortem Report — cross-check factual consistency such as: diagnosis/injury description across documents, admission/discharge dates matching the medical bills period, and disability percentage matching the certificate.

1. List each cross-check you can actually perform from the text given.
2. Flag any discrepancy the text actually supports (e.g. injury described differently across two documents, billed period doesn't match stated admission/discharge dates, disability percentage differs between documents) — only flag what is explicitly stated, never infer or guess, and never offer a medical opinion on treatment or diagnosis.
3. If a relevant document isn't present in the text, or a fact isn't stated, say so rather than assuming a value.
4. Every check and every discrepancy must name which document(s) it came from.

Respond with ONLY this JSON shape, no other text:
{
  "checks": [{"item": "what was cross-checked", "result": "what was found, stated plainly", "source": "which document(s)"}],
  "discrepancies": [{"description": "plain-language explanation", "severity": "high|medium|low", "source": "which document(s)"}],
  "confidence": "high|medium|low"
}

CASE DOCUMENTS:
${docsText}`;
}

async function _computeMedicalIntelligence({ docsText }, { onStatus } = {}) {
  return _computeChecksAndDiscrepancies(_buildMedicalIntelligencePrompt, docsText, {
    emptyMessage: "No medical documents found to cross-check.",
    tooLongMessage: "Medical cross-check too long — try including fewer documents.",
    onStatus,
  });
}

function _buildDigitalEvidenceIntelligencePrompt(docsText) {
  return `You are reviewing DESCRIBED visual/digital evidence for an Indian motor insurance (MACT) investigation, purely from the text descriptions provided — you have no access to the actual image, video, or file data itself, so you cannot assess authenticity, tampering, or metadata; you can only check whether the described evidence is consistent with, or contradicts, what other documents state.

From the case document text below — which may include Photographs / Visual Evidence descriptions and any CCTV/dashcam mentions elsewhere — check:
1. Completeness: which categories of visual evidence are described as present (scene photos, vehicle damage photos, injury photos, CCTV/dashcam) and which are explicitly stated as absent or simply not mentioned.
2. Consistency: does the described evidence match facts stated elsewhere (e.g. photographed damage location matches the DAR's description of impact) — only flag a contradiction the text actually supports.
3. If no visual evidence documentation is present in the text, say so rather than assuming any exists.
4. Every check and every discrepancy must name which document(s) it came from.

Respond with ONLY this JSON shape, no other text:
{
  "checks": [{"item": "what was cross-checked", "result": "what was found, stated plainly", "source": "which document(s)"}],
  "discrepancies": [{"description": "plain-language explanation", "severity": "high|medium|low", "source": "which document(s)"}],
  "confidence": "high|medium|low"
}

CASE DOCUMENTS:
${docsText}`;
}

async function _computeDigitalEvidenceIntelligence({ docsText }, { onStatus } = {}) {
  return _computeChecksAndDiscrepancies(_buildDigitalEvidenceIntelligencePrompt, docsText, {
    emptyMessage: "No visual/digital evidence documentation found in the provided documents.",
    tooLongMessage: "Digital evidence cross-check too long — try including fewer documents.",
    onStatus,
  });
}

// Scoped to the "incident narrative" document cluster (FIR/Panchnama/DAR/Site Map/
// Chargesheet) specifically — deliberately distinct from Vehicle (vehicle facts),
// Person (identity), and Medical (medical facts), which each own their own domain.
function _buildCrossVerificationSummaryPrompt(docsText) {
  return `You are cross-checking whether the INCIDENT NARRATIVE — what happened, where, and how — is told consistently across the documents that each independently describe the accident scene, for an Indian motor insurance (MACT) investigation. You are not a legal authority; you can only compare what the provided text itself states.

From the case document text below — which may include FIR, Spot Panchnama, DAR (Detailed Accident Report), Site Map / Police Sketch, and Chargesheet — cross-check the core narrative facts: location of accident, date/time, manner of collision, and which vehicles/parties are described as involved, wherever two or more of these documents describe the same incident.

1. List each cross-check you can actually perform from the text given.
2. Flag any discrepancy the text actually supports (e.g. accident location differs between FIR and Spot Panchnama, manner of collision described differently between DAR and Chargesheet) — only flag what is explicitly stated, never infer or guess.
3. If one of these documents isn't present in the text, say so rather than assuming its content.
4. Every check and every discrepancy must name which document(s) it came from.

Respond with ONLY this JSON shape, no other text:
{
  "checks": [{"item": "what was cross-checked", "result": "what was found, stated plainly", "source": "which document(s)"}],
  "discrepancies": [{"description": "plain-language explanation", "severity": "high|medium|low", "source": "which document(s)"}],
  "confidence": "high|medium|low"
}

CASE DOCUMENTS:
${docsText}`;
}

async function _computeCrossVerificationSummary({ docsText }, { onStatus } = {}) {
  return _computeChecksAndDiscrepancies(_buildCrossVerificationSummaryPrompt, docsText, {
    emptyMessage: "No incident-narrative documents found to cross-check.",
    tooLongMessage: "Cross verification too long — try including fewer documents.",
    onStatus,
  });
}

// Distinct response shape from the checks/discrepancies modules above — this evaluates
// evidence QUALITY/RELIABILITY (single-source vs corroborated, internally thin
// statements), not pairwise document facts. Deliberately does not restate the main
// report's own findings/observations/conclusion — a different lens, not a duplicate.
function _buildAIInvestigationFindingsPrompt(docsText) {
  return `You are reviewing case documents for an Indian motor insurance (MACT) investigation to surface findings about the QUALITY and RELIABILITY of the evidence presented — not to restate what happened (that belongs in the main report's own findings), and not a legal opinion — purely observations the text itself supports.

From the case document text below, identify findings such as: whether an account is corroborated by more than one independent source or rests on a single interested party, whether two documents describing the same event differ in a way worth noting, or whether a document's own content raises a question (e.g. a statement is unusually brief, a report gives no explanation for something it would normally explain). Only report what the text actually shows — never speculate about intent, fraud, or guilt, and never invent a finding the text doesn't support.

Respond with ONLY this JSON shape, no other text:
{
  "findings": [{"observation": "plain-language finding", "significance": "high|medium|low", "source": "which document(s)"}],
  "confidence": "high|medium|low"
}

CASE DOCUMENTS:
${docsText}`;
}

async function _computeAIInvestigationFindings({ docsText }, { onStatus } = {}) {
  const prompt = _buildAIInvestigationFindingsPrompt(docsText);
  const response = await _runQueued(() => _request("/ki/completion", {
    prompt, max_tokens: 2000, model_tier: "fast",
  }, { onStatus }), onStatus);
  const parsed = await _parseJsonContent(response, { maxTokensMessage: "Findings too long — try including fewer documents." });
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid findings response shape");

  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findingLines = findings.map((f) => `[${(f.significance || "").toUpperCase()}] ${f.observation || "(no observation stated)"} (${f.source || "source not stated"})`).join("\n");
  const summary = findings.length === 0
    ? "No notable evidence-quality findings beyond what's already in the report narrative."
    : `${findings.length} finding${findings.length === 1 ? "" : "s"} noted.`;
  const references = [...new Set(findings.map((f) => f.source).filter(Boolean))];

  return {
    status: "Pending Verification",
    summary,
    details: findingLines || null,
    confidence: parsed.confidence || null,
    source: "AI-extracted from uploaded case documents",
    asOf: new Date().toISOString(),
    verifiedBy: null,
    manualReview: false,
    evidence: [],
    references,
    lastUpdated: new Date().toISOString(),
    version: 1,
  };
}

// Own shape again (riskLevel + weighted factors) — riskLevel is folded into the plain
// summary/details text rather than a new field, since the frozen contract has no
// dedicated "score" field and none is being added.
function _buildRiskAssessmentPrompt(docsText) {
  return `You are identifying standard, well-known fraud/risk indicators for an Indian motor insurance (MACT) investigation, purely from what the provided documents explicitly state — you are not making a fraud determination, only surfacing factors an investigator would want to weigh, each grounded in the text.

From the case document text below, look for well-established risk indicators such as: unexplained delay in lodging the FIR, absence of independent eyewitnesses, conflicting statements between parties, income or age claims unsupported by documentary proof, or discrepancies already evident in the text. Only cite a factor the text actually supports — never infer motive or guilt, and never invent a factor that isn't grounded in what's written. If nothing in the text supports any risk factor, say the risk level is low for lack of evidence otherwise, not because the case has been cleared.

Respond with ONLY this JSON shape, no other text:
{
  "riskLevel": "low|medium|high",
  "factors": [{"factor": "plain-language risk factor", "weight": "high|medium|low", "source": "which document(s)"}],
  "confidence": "high|medium|low"
}

CASE DOCUMENTS:
${docsText}`;
}

async function _computeRiskAssessment({ docsText }, { onStatus } = {}) {
  const prompt = _buildRiskAssessmentPrompt(docsText);
  const response = await _runQueued(() => _request("/ki/completion", {
    prompt, max_tokens: 1500, model_tier: "fast",
  }, { onStatus }), onStatus);
  const parsed = await _parseJsonContent(response, { maxTokensMessage: "Risk assessment too long — try including fewer documents." });
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid risk assessment response shape");

  const factors = Array.isArray(parsed.factors) ? parsed.factors : [];
  const riskLevel = ["low", "medium", "high"].includes((parsed.riskLevel || "").toLowerCase()) ? parsed.riskLevel.toLowerCase() : null;
  const factorLines = factors.map((f) => `[${(f.weight || "").toUpperCase()}] ${f.factor || "(unspecified factor)"} (${f.source || "source not stated"})`).join("\n");
  const summary = riskLevel
    ? `Overall risk level: ${riskLevel}. ${factors.length} factor${factors.length === 1 ? "" : "s"} identified.`
    : "No risk level could be determined from the provided documents.";
  const references = [...new Set(factors.map((f) => f.source).filter(Boolean))];

  return {
    status: "Pending Verification",
    summary,
    details: factorLines || null,
    confidence: parsed.confidence || null,
    source: "AI-extracted from uploaded case documents",
    asOf: new Date().toISOString(),
    verifiedBy: null,
    manualReview: false,
    evidence: [],
    references,
    lastUpdated: new Date().toISOString(),
    version: 1,
  };
}

// Alerts flag ABSENCE, not a fact drawn from a document — "checkedIn" grounds the claim
// in what was actually reviewed and found silent, rather than an unsupported guess.
function _buildInvestigatorAlertsPrompt(docsText) {
  return `You are checking for STANDARD investigative steps or documents that appear to be missing or incomplete, for an Indian motor insurance (MACT) investigation, purely from what is and isn't present in the provided text — you are not making a legal judgment, only flagging gaps a thorough investigation would normally want to close.

From the case document text below, identify standard items that appear absent or incomplete — for example: no statement from the TP driver, no independent eyewitness statement, no photographic evidence of vehicle damage, no explanation given for a stated delay, or a document referenced elsewhere but not itself included. Only flag an absence you can actually confirm from what's given.

Respond with ONLY this JSON shape, no other text:
{
  "alerts": [{"alert": "plain-language description of what's missing or incomplete", "priority": "high|medium|low", "checkedIn": "which document(s) were reviewed and found silent on this"}],
  "confidence": "high|medium|low"
}

CASE DOCUMENTS:
${docsText}`;
}

async function _computeInvestigatorAlerts({ docsText }, { onStatus } = {}) {
  const prompt = _buildInvestigatorAlertsPrompt(docsText);
  const response = await _runQueued(() => _request("/ki/completion", {
    prompt, max_tokens: 1500, model_tier: "fast",
  }, { onStatus }), onStatus);
  const parsed = await _parseJsonContent(response, { maxTokensMessage: "Investigator alerts too long — try including fewer documents." });
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid investigator alerts response shape");

  const alerts = Array.isArray(parsed.alerts) ? parsed.alerts : [];
  const alertLines = alerts.map((a) => `[${(a.priority || "").toUpperCase()}] ${a.alert || "(unspecified alert)"} (checked: ${a.checkedIn || "not stated"})`).join("\n");
  const summary = alerts.length === 0
    ? "No procedural gaps identified from the provided documents."
    : `${alerts.length} item${alerts.length === 1 ? "" : "s"} flagged for investigator follow-up.`;
  const references = [...new Set(alerts.map((a) => a.checkedIn).filter(Boolean))];

  return {
    status: "Pending Verification",
    summary,
    details: alertLines || null,
    confidence: parsed.confidence || null,
    source: "AI-extracted from uploaded case documents",
    asOf: new Date().toISOString(),
    verifiedBy: null,
    manualReview: false,
    evidence: [],
    references,
    lastUpdated: new Date().toISOString(),
    version: 1,
  };
}

const _MODULE_IMPLEMENTATIONS = {
  timelineIntelligence: _computeTimelineIntelligence,
  vehicleIntelligence: _computeVehicleIntelligence,
  personIntelligence: _computePersonIntelligence,
  medicalIntelligence: _computeMedicalIntelligence,
  digitalEvidenceIntelligence: _computeDigitalEvidenceIntelligence,
  crossVerificationSummary: _computeCrossVerificationSummary,
  aiInvestigationFindings: _computeAIInvestigationFindings,
  riskAssessment: _computeRiskAssessment,
  investigatorAlerts: _computeInvestigatorAlerts,
};

// ── Investigation Decision Engine (v1.1 addition — synthesis pass) ──
// Unlike every module above, this one must never read docsText — only the
// OTHER modules' already-computed output. It is deliberately NOT registered
// in _MODULE_IMPLEMENTATIONS: that map's dispatch loop only ever hands a
// module {docsText}, and giving a synthesis module that parameter would be
// the one thing the design must not do. Instead it lives in its own map,
// _SYNTHESIS_MODULE_IMPLEMENTATIONS below, run as a second pass by
// getLegalIntelligence() AFTER the first pass resolves — see that function
// for why this needs to be a second pass rather than an entry in the first.

// Formats resolved ModuleRecords as plain-text blocks for the synthesis
// prompt. Loops `modules` generically — never names a specific module_id —
// so a future 11th document-based module is included automatically the next
// time this runs, with no change needed here or in the prompt below.
function _formatModulesForSynthesis(modules) {
  return (modules || [])
    .filter((m) => m.status !== "Not Performed" && m.status !== "Not Applicable")
    .map((m) => {
      const refs = (m.references || []).join(", ") || "none stated";
      return `=== ${m.moduleLabel} (${m.status}) ===\nSummary: ${m.summary || "(none)"}\nDetails: ${m.details || "(none)"}\nCites: ${refs}`;
    })
    .join("\n\n");
}

function _buildInvestigationDecisionEnginePrompt(modulesText) {
  return `You are synthesising a final investigation recommendation for an Indian motor insurance (MACT) investigation, based ONLY on the structured findings already produced by other intelligence modules below — you have no access to the original case documents, only these modules' own summaries. You are not a legal authority, not a medical authority, and you do not approve or reject claims — only the insurer makes that decision. You only produce an investigation recommendation for the insurer to consider.

Rules:
- Never invent a fact, finding, or number that isn't stated in the module output below.
- Every finding, piece of evidence, contradiction, and recommendation you list MUST name which module(s) it came from (use the exact module names as given below).
- Do not give legal advice. Do not give a medical opinion. Do not state whether the claim should be approved or rejected — only whether the evidence is sufficient, and what further investigation (if any) is needed.
- If the modules below don't support a conclusion, say so rather than guessing.

MODULE OUTPUT (this is your only source of information):
${modulesText}

Respond with ONLY this JSON shape, no other text:
{
  "executiveSummary": "2-4 sentence plain-language overview of what the evidence shows so far",
  "decisionStatus": "Sufficient Evidence" or "Requires Further Investigation" or "Insufficient Evidence",
  "keyFindings": [{"finding": "plain-language finding", "supportingModules": ["exact module name(s)"]}],
  "supportingEvidence": [{"point": "what supports the case", "supportingModules": ["exact module name(s)"]}],
  "contradictions": [{"description": "plain-language contradiction", "severity": "high|medium|low", "supportingModules": ["exact module name(s)"]}],
  "missingEvidence": [{"item": "what's missing or unresolved", "impact": "why it matters"}],
  "investigatorRecommendations": [{"recommendation": "what the investigator should do next", "supportingModules": ["exact module name(s)"]}],
  "furtherActionsRequired": [{"action": "concrete next step", "priority": "high|medium|low"}],
  "humanReviewRequired": true or false,
  "confidence": "high|medium|low"
}`;
}

// Signature is deliberately { modules } — there is no docsText parameter for
// this function to misuse, even accidentally. That is what makes "never
// reads raw documents directly" a structural fact rather than a convention.
async function _computeInvestigationDecisionEngine({ modules }, { onStatus } = {}) {
  const usable = (modules || []).filter((m) => m.status !== "Not Performed" && m.status !== "Not Applicable");
  if (usable.length === 0) {
    // Nothing to synthesise yet (no other module has real data) — resolve as
    // a placeholder without spending an AI call on an empty synthesis.
    return _emptyModuleRecord(null, null);
  }

  const modulesText = _formatModulesForSynthesis(modules);
  const prompt = _buildInvestigationDecisionEnginePrompt(modulesText);
  const response = await _runQueued(() => _request("/ki/completion", {
    prompt, max_tokens: 2500, model_tier: "fast",
  }, { onStatus }), onStatus);
  const parsed = await _parseJsonContent(response, { maxTokensMessage: "Investigation decision too long — try refreshing with fewer modules populated." });
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid investigation decision response shape");

  // Defensive: an off-spec AI response degrades to empty sections rather
  // than throwing — same posture as every module above.
  const keyFindings = Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [];
  const supportingEvidence = Array.isArray(parsed.supportingEvidence) ? parsed.supportingEvidence : [];
  const contradictions = Array.isArray(parsed.contradictions) ? parsed.contradictions : [];
  const missingEvidence = Array.isArray(parsed.missingEvidence) ? parsed.missingEvidence : [];
  const investigatorRecommendations = Array.isArray(parsed.investigatorRecommendations) ? parsed.investigatorRecommendations : [];
  const furtherActionsRequired = Array.isArray(parsed.furtherActionsRequired) ? parsed.furtherActionsRequired : [];

  const section = (title, lines) => (lines.length ? `${title}:\n${lines.join("\n")}` : "");
  const details = [
    section("KEY FINDINGS", keyFindings.map((f) => `- ${f.finding || "(unspecified)"} (${(f.supportingModules || []).join(", ") || "source not stated"})`)),
    section("SUPPORTING EVIDENCE", supportingEvidence.map((e) => `- ${e.point || "(unspecified)"} (${(e.supportingModules || []).join(", ") || "source not stated"})`)),
    section("CONTRADICTIONS", contradictions.map((c) => `[${(c.severity || "").toUpperCase()}] ${c.description || "(unspecified)"} (${(c.supportingModules || []).join(", ") || "source not stated"})`)),
    section("MISSING EVIDENCE", missingEvidence.map((m) => `- ${m.item || "(unspecified)"} — ${m.impact || "impact not stated"}`)),
    section("INVESTIGATOR RECOMMENDATIONS", investigatorRecommendations.map((r) => `- ${r.recommendation || "(unspecified)"} (${(r.supportingModules || []).join(", ") || "source not stated"})`)),
    section("FURTHER ACTIONS REQUIRED", furtherActionsRequired.map((a) => `[${(a.priority || "").toUpperCase()}] ${a.action || "(unspecified)"}`)),
  ].filter(Boolean).join("\n\n");

  // "Decision Status" is new prose vocabulary living inside `summary` —
  // deliberately NOT the same thing as the record's own `status` field
  // (which keeps its existing, different meaning: whether this module's own
  // AI call succeeded, same as every other module).
  const decisionStatus = typeof parsed.decisionStatus === "string" && parsed.decisionStatus.trim()
    ? parsed.decisionStatus.trim()
    : "Requires Further Investigation";
  const summary = `Decision Status: ${decisionStatus}. ${parsed.executiveSummary || "No executive summary produced."}`;

  // references = every distinct module actually cited anywhere above — this
  // is what makes "every recommendation must cite supporting modules" a
  // checkable fact about the stored record, not just a prompt instruction.
  const references = [...new Set([
    ...keyFindings.flatMap((f) => f.supportingModules || []),
    ...supportingEvidence.flatMap((e) => e.supportingModules || []),
    ...contradictions.flatMap((c) => c.supportingModules || []),
    ...investigatorRecommendations.flatMap((r) => r.supportingModules || []),
  ].filter(Boolean))];

  return {
    status: "Pending Verification",
    summary,
    details: details || null,
    confidence: parsed.confidence || null,
    source: "Synthesised from other Legal & Investigation Intelligence modules",
    asOf: new Date().toISOString(),
    verifiedBy: null,
    manualReview: parsed.humanReviewRequired === true,
    evidence: [],
    references,
    lastUpdated: new Date().toISOString(),
    version: 1,
  };
}

const _SYNTHESIS_MODULE_IMPLEMENTATIONS = {
  investigationDecisionEngine: _computeInvestigationDecisionEngine,
};

// FUTURE — not built yet, documented so it can be lifted verbatim into
// bima-anveshak-ai/apps/ai-services/routers/ once the v1.0 feature freeze lifts:
//
//   POST /ki/intelligence   (same _validate_jwt + role-check pattern as ki_drafter.py)
//   Request:  { caseData: {...}, requestedModules?: string[] }  // module_id values from
//             the legal_intelligence_modules registry; omit for all enabled modules.
//   Response: { schemaVersion, generatedAt, modules: ModuleRecord[] }  — same envelope
//             getLegalIntelligence() already returns below, just populated. Reads the
//             SAME registry table, so KEY Investigations and Bima Anveshak never
//             disagree on which modules exist.
//
// When this ships, only getLegalIntelligence()'s body below changes to a real
// _request("/ki/intelligence", ...) call — every caller stays the same. API contract
// rules: additive-only fields, unknown fields/modules must be ignored (not fatal), and
// the module list is always response-driven — a client never assumes a fixed count.

function _notImplemented(featureName) {
  return Promise.resolve({
    available: false,
    feature: featureName,
    message: `${featureName} is not available yet. It will connect to the Bima Anveshak AI Engine in a future release.`,
  });
}

// ── Public interface ──
const AIService = {
  // Reads uploaded documents for one report section and returns extracted field values.
  // Return shape is additive: the named category fields and "_identitySignals" as
  // documented in _buildDocumentAutoFillPrompt, plus "_pageCount" (how many
  // images/pages this call actually processed) — a deterministic fact the caller
  // can use to warn on a likely multi-document bundle, not something the model states.
  async autoFillDocument({ category, files }, { onStatus } = {}) {
    const { images, textBlock } = await _filesToPayload(files);
    const prompt = _buildDocumentAutoFillPrompt(category, textBlock);
    const response = await _runQueued(() => _request("/ki/vision", {
      images, prompt, max_tokens: 6144, model_tier: "fast",
    }, { onStatus }), onStatus);
    const parsed = await _parseJsonContent(response, { maxTokensMessage: "Content too long — try uploading fewer pages at once." });
    return { ...parsed, _pageCount: images.length };
  },

  // Reads uploaded documents and returns extracted case header fields.
  async autoFillCaseHeader({ files }, { onStatus } = {}) {
    const { images, textBlock } = await _filesToPayload(files);
    const prompt = _buildHeaderAutoFillPrompt(textBlock);
    const response = await _runQueued(() => _request("/ki/vision", {
      images, prompt, max_tokens: 1024, model_tier: "fast",
    }, { onStatus }), onStatus);
    return _parseJsonContent(response);
  },

  // Drafts the full investigation report from case data + included document sections.
  // Uses the "best" model tier (Opus) — this is a legal/court document, quality over cost.
  // identityConflicts (optional) is a pre-computed, deterministic list from the caller
  // (report.html's detectIdentityConflicts) — see _buildReportPrompt for how it's used.
  async generateReport({ caseData, docsText, sectionKeys, extraNotes, identityConflicts }, { onStatus } = {}) {
    const prompt = _buildReportPrompt({ caseData, docsText, sectionKeys, extraNotes, identityConflicts });
    const response = await _runQueued(() => _request("/ki/completion", {
      prompt, max_tokens: 16000, model_tier: "best",
    }, { onStatus }), onStatus);
    return _parseJsonContent(response, { maxTokensMessage: "Report too long — try regenerating." });
  },

  // Produces a structured top-down accident schematic from accident facts.
  async generateAccidentDiagram({ accidentText }, { onStatus } = {}) {
    const prompt = _buildDiagramPrompt(accidentText);
    const response = await _runQueued(() => _request("/ki/completion", {
      prompt, max_tokens: 1000, model_tier: "fast",
    }, { onStatus }), onStatus);
    return _parseJsonContent(response);
  },

  // Legal & Investigation Intelligence — permanent report section, shared contract
  // with Bima Anveshak. Reads the Layer 1 registry table; any module with a real
  // implementation (see _MODULE_IMPLEMENTATIONS above) computes for real when docsText
  // is provided, everything else stays a placeholder. No docsText (page load, new
  // draft) means zero AI calls — real computation is opt-in, triggered only by the
  // Refresh button, same as accident diagram generation. Swapping in a real
  // /ki/intelligence backend later only changes this function's body (see FUTURE
  // comment above) — callers and the module dispatch pattern stay the same.
  async getLegalIntelligence({ caseData, docsText } = {}, { onStatus } = {}) {
    const registry = await _fetchModuleRegistry();
    const modules = await Promise.all(registry.map(async (m) => {
      const impl = docsText && _MODULE_IMPLEMENTATIONS[m.module_id];
      if (impl) {
        try {
          const record = await impl({ docsText }, { onStatus });
          return { ...record, moduleId: m.module_id, moduleLabel: m.module_label };
        } catch (e) {
          console.error(`Legal intelligence module "${m.module_id}" failed, showing placeholder:`, e);
        }
      }
      return _emptyModuleRecord(m.module_id, m.module_label);
    }));

    // Second pass — synthesis modules (v1.1 addition: Investigation Decision
    // Engine). These consume the FIRST pass's already-resolved `modules`
    // array, never docsText — see _SYNTHESIS_MODULE_IMPLEMENTATIONS above.
    // Run sequentially in registry sort_order (not Promise.all) so a future
    // second synthesis module could see an earlier one's output too; today
    // there is only one, so this just establishes the rule ahead of needing
    // it. A synthesis module's own registry row already resolved as a
    // placeholder in the first pass above — replace that entry in place.
    for (const m of registry) {
      const impl = _SYNTHESIS_MODULE_IMPLEMENTATIONS[m.module_id];
      if (!impl) continue;
      const idx = modules.findIndex((rec) => rec.moduleId === m.module_id);
      try {
        const record = await impl({ modules }, { onStatus });
        modules[idx] = { ...record, moduleId: m.module_id, moduleLabel: m.module_label };
      } catch (e) {
        console.error(`Legal intelligence synthesis module "${m.module_id}" failed, showing placeholder:`, e);
        modules[idx] = _emptyModuleRecord(m.module_id, m.module_label);
      }
    }

    return {
      schemaVersion: LEGAL_INTELLIGENCE_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      modules,
    };
  },
};
