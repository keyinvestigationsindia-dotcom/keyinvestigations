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
{ ${fieldList} }
${analysisHintBlock}

Rules:
- Return ONLY a JSON object with exactly these keys, nothing else (no markdown fences, no preamble).
- For each field, put the relevant extracted/translated information as a string.
- If a field's information is not visible or not present anywhere, set it to an empty string "" — do NOT guess.
- For narrative/long text fields, summarize in formal English, faithful to the source.
- If images are unreadable or blank and no text is provided, return all fields as empty strings.${textBlock}`;
}

function _buildHeaderAutoFillPrompt(textBlock) {
  return `You are reading insurance claim document(s) — could be a claim intimation letter, policy copy, RC, petition, or FIR — possibly in any major Indian language or English. Extract the following case-level fields, translating into English:
{
  "claimType": "one of exactly: 'MACT Death Claim', 'MACT Injury Claim', 'TPPD Claim'. Empty string if unclear.",
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

function _buildReportPrompt({ caseData, docsText, sectionKeys, extraNotes }) {
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
- You may ONLY improve grammar, sentence flow, readability, and professional language. Zero factual drift.

REPORT STRUCTURE:
1. "sections" — Each document category gets a DETAILED factual brief (3-6 sentences), written in formal investigative language with ALL factual details inline. Not a summary — a comprehensive factual extract written like a professional investigator's notes.
2. "findings" — A structured, numbered list of KEY established facts drawn from ALL documents. Each finding must be a complete, self-contained factual statement with all identifiers inline. Group logically: (a) Accident facts (b) Victim/injured details (c) Vehicle & document verification (d) Statement analysis (e) Medical/cause findings (f) Discrepancies noted.
3. "observations" — This is the MAIN body of the report. Write a DETAILED, CHRONOLOGICAL narrative (minimum 800 words for a complete case) structured as follows:
   (a) Introduction & assignment: Who assigned, reference, purpose of investigation.
   (b) Accident circumstances: Complete reconstruction from FIR, panchnama, DAR — with exact location, date/time, vehicles, sequence of events, all inline.
   (c) Scene of accident / spot details: What was found at the spot, road conditions, evidence.
   (d) Victim/deceased/injured particulars: Full identity with cross-document age/DOB comparison inline.
   (e) Medical / cause of death / injuries: Hospital, admission, treatment, MLC findings, PM findings — all chronological with dates inline.
   (f) Statements analysis: What each witness/insured/driver/claimant said — with critical analysis of who actually saw vs who arrived later, contradictions noted inline.
   (g) Vehicle & document verification: IV and TP vehicle details, RC, permit, fitness, DL, policy — each verified with validity dates inline, any gaps or mismatches noted immediately.
   (h) Police/legal proceedings: FIR, chargesheet, sections applied — all inline.
   (i) Discrepancies & red flags: Woven into the narrative where they naturally arise, not as a separate list.
   The observations must read as one continuous, authoritative investigation narrative — not as disconnected paragraphs. Each paragraph must flow into the next with proper transitions.
4. "conclusion" — A comprehensive closing assessment (4-8 sentences) with clear determination on: (a) whether the accident is genuine/staged (b) liability assessment (c) document compliance status (d) any recommendations for the insurer.

Produce a JSON object (nothing else) with this shape:
{
  "sections": {
    ${sectionKeys ? sectionKeys.split(", ").map(k => `"${k}": "DETAILED factual brief (3-6 sentences, all facts inline)"`).join(",\n    ") : '"none": "no categories selected"'}
  },
  "redFlags": [
    {"flag": "title", "detail": "detailed explanation with exact mismatched values cited", "severity": "high|medium|low"}
  ],
  "findings": "numbered list (\\n between items, prefix with '1. ', '2. ' etc.), grouped by category",
  "observations": "DETAILED chronological narrative (minimum 800 words), formal investigative language, every fact inline, sequence: accident → victim → medical → statements → documents → discrepancies",
  "conclusion": "comprehensive 4-8 sentence closing assessment with determination and recommendations"
}

Rules for redFlags (be thorough — a senior investigator catches everything):
(1) Age/DOB mismatches across ANY documents — cite exact values from each source
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
Empty array ONLY if genuinely nothing found.

CASE HEADER:
Claim Type: ${caseData.claimType}
Claim No: ${caseData.claimNo}
Court: ${caseData.court}
Claim Amount: ${caseData.claimAmount}
Date of Accident: ${caseData.doa}
Insured Vehicle: ${caseData.ivVehicle}
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

From the case document text below, extract every explicitly dated event (accident, FIR lodging, panchnama, admission/discharge, postmortem, death, chargesheet, etc.) and:
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

const _MODULE_IMPLEMENTATIONS = {
  timelineIntelligence: _computeTimelineIntelligence,
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
  async autoFillDocument({ category, files }, { onStatus } = {}) {
    const { images, textBlock } = await _filesToPayload(files);
    const prompt = _buildDocumentAutoFillPrompt(category, textBlock);
    const response = await _runQueued(() => _request("/ki/vision", {
      images, prompt, max_tokens: 6144, model_tier: "fast",
    }, { onStatus }), onStatus);
    return _parseJsonContent(response, { maxTokensMessage: "Content too long — try uploading fewer pages at once." });
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
  async generateReport({ caseData, docsText, sectionKeys, extraNotes }, { onStatus } = {}) {
    const prompt = _buildReportPrompt({ caseData, docsText, sectionKeys, extraNotes });
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
    return {
      schemaVersion: LEGAL_INTELLIGENCE_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      modules,
    };
  },
};
