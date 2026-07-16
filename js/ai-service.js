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

  // ── Future Bima Anveshak AI Engine features ──
  // Interfaces only — not implemented. Each resolves { available: false } instead
  // of calling any endpoint. When the corresponding Bima Anveshak AI endpoint
  // ships, fill in the body with a real _request(...) call; callers do not change.
  async backgroundVerification(input) { return _notImplemented("Background Verification"); },
  async crimeCheck(input) { return _notImplemented("Crime Check"); },
  async fraudDetection(input) { return _notImplemented("Fraud Detection"); },
  async timelineIntelligence(input) { return _notImplemented("Timeline Intelligence"); },
  async crossVerification(input) { return _notImplemented("Cross Verification"); },
  async riskScoring(input) { return _notImplemented("Risk Scoring"); },
};
