// ============================================================
// KEY Investigations – Combined PDF Intake Service (Phase 1)
// ============================================================
// Common, claim-agnostic Combined PDF Intake Foundation only — see
// docs/document-intake-pipeline/architecture-assessment.md and
// phase-1-implementation-plan.md. NOT implemented here, by design:
// Health/TP/OD/Theft-specific intelligence, investigation_events,
// investigation_event_links, claim_intelligence_adapters — those are
// Phase 2+ and belong to the claim-specific adapter documents, never to
// this file.
//
// Deliberately separate from js/ai-service.js, kept at zero diff this
// phase: its own transport helpers and PDF renderer are duplicated below
// rather than imported/exported, so the 13 already-shipped Legal
// Intelligence modules have provably zero exposure to this change (see
// phase-1-implementation-plan.md §2/§3 for the reasoning).
//
// Pass 2 (final per-group extraction) reuses AIService.autoFillDocument
// completely unchanged — this file never re-implements field extraction,
// only produces confirmed document groups and hands real File objects to
// the existing function, the same way manual per-category upload does.

// ── Configuration (mutable, not hardcoded — see IntakeService.configure) ──
let _pageCeiling = 300;          // configurable; initial value per architecture-assessment.md §1b
const INTAKE_BATCH_SIZE = 20;    // internal processing constraint only — independent of the ceiling, never changed at runtime
let _concurrencyLimit = 3;       // configurable; see phase-1-implementation-plan.md §8 for the rationale
const INTAKE_STORAGE_BUCKET = "intake-page-renders";
const SEAM_CONTEXT_WINDOW = 3;   // pages considered on each side of a batch boundary for Pass 1b
const MAX_PLAUSIBLE_GROUP_PAGES = 40; // Pass 1c implausible-span flag threshold

// ── Transport (duplicated from js/ai-service.js's _request/_parseJsonContent
// on purpose — see file header) ──
const INTAKE_AI_ENGINE_BASE_URL = "https://bima-ai-service.onrender.com";

async function _intakeRequest(endpoint, body, { maxRetries = 4, onStatus } = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = "login.html"; throw new Error("Session expired"); }
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(INTAKE_AI_ENGINE_BASE_URL + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.access_token },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      window.location.href = "login.html";
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

async function _intakeDescribeFailedResponse(response) {
  const errBody = await response.text().catch(() => "");
  if (/^\s*<!doctype html/i.test(errBody) || /^\s*<html/i.test(errBody))
    return `Request failed (${response.status}) — payload may be too large.`;
  return `API error ${response.status}: ${errBody.slice(0, 200) || "no details"}`;
}

async function _intakeParseJsonContent(response, { maxTokensMessage } = {}) {
  if (!response.ok) throw new Error(await _intakeDescribeFailedResponse(response));
  const data = await response.json();
  if (!data.content) throw new Error("Unexpected response from AI service.");
  if (maxTokensMessage && data.stop_reason === "max_tokens") throw new Error(maxTokensMessage);
  return JSON.parse(data.content.replace(/```json|```/g, "").trim());
}

// ── Bounded concurrency queue — deliberately separate from ai-service.js's
// _aiQueue. That queue reassigns its shared promise synchronously on every
// call, which strictly serializes everything through it regardless of
// Promise.all (traced in phase-1-implementation-plan.md §8). Reusing it here
// would either silently serialize Pass 1a/1b (defeating the point of
// batching) or let a large intake starve a concurrent Legal Intelligence
// refresh in the same tab. This queue instead runs up to `_concurrencyLimit`
// calls at once — bounded, not unbounded Promise.all, and reads the limit
// live on every scheduling decision so it stays genuinely configurable. ──
let _intakeActive = 0;
const _intakePending = [];
function _intakeRunNext() {
  while (_intakeActive < _concurrencyLimit && _intakePending.length > 0) {
    const { fn, resolve, reject } = _intakePending.shift();
    _intakeActive++;
    Promise.resolve().then(fn).then(
      (v) => { _intakeActive--; resolve(v); _intakeRunNext(); },
      (e) => { _intakeActive--; reject(e); _intakeRunNext(); }
    );
  }
}
function _enqueueIntakeCall(fn) {
  return new Promise((resolve, reject) => {
    _intakePending.push({ fn, resolve, reject });
    _intakeRunNext();
  });
}
// Observable, per Phase 1's explicit "keep concurrency configurable and
// observable" requirement.
function _getConcurrencyStatus() {
  return { active: _intakeActive, pending: _intakePending.length, limit: _concurrencyLimit };
}

// ── PDF rendering — deliberately NOT _pdfFileToImages. That function keeps
// its existing Math.min(pdf.numPages, 20) cap for its existing callers
// (autoFillDocument, autoFillCaseHeader), which must not change. This is a
// new, separate renderer with no such cap, bounded only by the configured
// ceiling, checked BEFORE any page is rendered — the cheapest possible
// rejection point, and the mechanism that makes "no silent truncation" true
// by construction rather than by convention. ──
let _intakePdfjs = null;
async function _loadPdfJsForIntake() {
  if (_intakePdfjs) return _intakePdfjs;
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
  _intakePdfjs = window.pdfjsLib;
  return window.pdfjsLib;
}

async function _renderAllPages(file, { onProgress } = {}) {
  const pdfjsLib = await _loadPdfJsForIntake();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageCount = pdf.numPages;
  if (pageCount > _pageCeiling) {
    const err = new Error(
      `This PDF has ${pageCount} pages, which exceeds the configured ceiling of ${_pageCeiling}. ` +
      `Nothing was processed or uploaded — split the PDF into smaller bundles, or raise the configured ceiling.`
    );
    err.code = "PAGE_CEILING_EXCEEDED";
    err.pageCount = pageCount;
    err.ceiling = _pageCeiling;
    throw err;
  }
  const images = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push({ pageIndex: i - 1, dataUrl: canvas.toDataURL("image/jpeg", 0.82) });
    if (onProgress) onProgress({ stage: "rendering", rendered: i, total: pageCount });
  }
  return { pageCount, images };
}

// ── dataUrl conversion helpers — one canonical per-page representation
// (dataUrl), converted on demand into whatever shape each consumer needs. ──
function _dataUrlParts(dataUrl) {
  const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid rendered page image.");
  return { mediaType: match[1], base64: match[2] };
}
// Shape the AI Engine's /ki/vision endpoint already expects — identical to
// what js/ai-service.js's own _pdfFileToImages/_fileToOptimizedBase64 send.
function _dataUrlToImagePayload(dataUrl) {
  const { mediaType, base64 } = _dataUrlParts(dataUrl);
  return { mediaType, data: base64 };
}
function _dataUrlToBlob(dataUrl) {
  const { mediaType, base64 } = _dataUrlParts(dataUrl);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType });
}
// Real File object — used for Pass 2, so it flows through the existing,
// completely unmodified AIService.autoFillDocument -> _filesToPayload path,
// rather than re-implementing that path's image handling here.
function _dataUrlToFile(dataUrl, filename) {
  const blob = _dataUrlToBlob(dataUrl);
  return new File([blob], filename, { type: blob.type });
}

// ── Storage — private bucket, signed URLs only, never a public URL ──
async function _uploadPageImage(sessionId, pageIndex, dataUrl) {
  const blob = _dataUrlToBlob(dataUrl);
  const path = `${sessionId}/page-${String(pageIndex).padStart(4, "0")}.jpg`;
  const { error } = await sb.storage.from(INTAKE_STORAGE_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`Failed to store rendered page ${pageIndex + 1}: ${error.message}`);
  return path;
}
async function _getSignedPageUrl(path, { expiresIn = 3600 } = {}) {
  const { data, error } = await sb.storage.from(INTAKE_STORAGE_BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw new Error(`Failed to get a signed URL for this page: ${error.message}`);
  return data.signedUrl;
}

// ── Pass 1a — per-batch classification ──
function _buildPass1aPrompt(docCategoriesVocab) {
  const vocabList = docCategoriesVocab.map((c) => `- ${c.title}`).join("\n");
  return `You are classifying scanned pages from a combined PDF bundle for an Indian insurance investigation. Each image given is one page, in the order it appears in the bundle.

Known document types this bundle may contain (this list is not exhaustive — it covers what this investigation platform already has a place for):
${vocabList}

For EACH page image given, in order, report:
1. Which document type it most closely matches — respond with the EXACT title text from the list above, or the literal string "Unrecognized" if no listed type reasonably fits. Never invent a type not in the list.
2. Confidence: "high", "medium", or "low".
3. Whether this page appears to continue the SAME document as the page immediately before it within this batch (true/false). For the very first page given in this batch, always answer false — seam continuity across batch boundaries is handled separately.

Only classify based on what is actually visible in the image. If a page's type is genuinely unclear, use "Unrecognized" and "low" confidence rather than forcing a guess.

Respond with ONLY this JSON shape, no other text:
{"pages": [{"pageIndexInBatch": 0, "documentTypeGuess": "...", "confidence": "high|medium|low", "continuesFromPreviousPage": false}, ...]}`;
}

async function _computePass1a({ images, docCategoriesVocab }, { onStatus } = {}) {
  const prompt = _buildPass1aPrompt(docCategoriesVocab);
  const response = await _enqueueIntakeCall(() => _intakeRequest("/ki/vision", {
    images: images.map(_dataUrlToImagePayload), prompt, max_tokens: 4096, model_tier: "fast",
  }, { onStatus }));
  const parsed = await _intakeParseJsonContent(response, { maxTokensMessage: "Classification response too long for this batch." });
  return Array.isArray(parsed?.pages) ? parsed.pages : [];
}

// ── Pass 1b — per-seam reconciliation ──
function _buildPass1bPrompt() {
  return `You are checking whether a document CONTINUES across a page boundary inside a combined PDF bundle for an Indian insurance investigation, or whether a NEW document starts there. The boundary shown is an internal processing split only — it is not necessarily a real document boundary; a single document may legitimately span it.

You are given a short window of page images spanning that boundary, in order. Consider every signal actually visible in these images:
- Document headings / titles
- OCR/text continuity (does sentence or paragraph structure carry across the boundary)
- Named-entity identity (the same person or organization named on both sides — e.g. claimant, patient, driver, doctor, hospital, police station, insurer)
- Dates
- Page numbering (e.g. "3 of 5" followed by "4 of 5" is strong continuation evidence; a reset to "1 of 1" is strong new-document evidence)
- Repeated headers/footers (letterhead, stamp, form ID)
- Document formatting / layout consistency
- Narrative or content continuity (clinical, investigative, procedural, or otherwise)
- Handwriting/form continuity, where the source is handwritten or a fixed-layout form

Only use signals actually visible in the images given. If the evidence is genuinely mixed or insufficient, answer UNCERTAIN rather than guessing either way.

Respond with ONLY this JSON shape, no other text:
{"verdict": "SAME_DOCUMENT" | "NEW_DOCUMENT" | "UNCERTAIN", "confidence": "high|medium|low", "evidence": [{"signal": "...", "observation": "..."}]}`;
}

async function _computePass1b({ images }, { onStatus } = {}) {
  const prompt = _buildPass1bPrompt();
  const response = await _enqueueIntakeCall(() => _intakeRequest("/ki/vision", {
    images: images.map(_dataUrlToImagePayload), prompt, max_tokens: 1024, model_tier: "fast",
  }, { onStatus }));
  const parsed = await _intakeParseJsonContent(response, { maxTokensMessage: "Seam reconciliation response too long." });
  return {
    verdict: parsed?.verdict === "SAME_DOCUMENT" || parsed?.verdict === "NEW_DOCUMENT" ? parsed.verdict : "UNCERTAIN",
    confidence: parsed?.confidence || "low",
    evidence: Array.isArray(parsed?.evidence) ? parsed.evidence : [],
  };
}

// ── Batching / seam-context helpers (pure logic, no AI) ──
function _sliceIntoBatches(images, batchSize) {
  const batches = [];
  for (let i = 0; i < images.length; i += batchSize) batches.push(images.slice(i, i + batchSize));
  return batches;
}
function _buildSeamContext(images, seamIndex, batchSize, contextWindow) {
  const boundaryPageIndex = (seamIndex + 1) * batchSize; // first page of the batch AFTER this seam
  const start = Math.max(0, boundaryPageIndex - contextWindow);
  const end = Math.min(images.length, boundaryPageIndex + contextWindow);
  return images.slice(start, end).map((p) => p.dataUrl);
}
function _flattenPass1a(pass1aResults, batchSize) {
  const perPage = [];
  for (const br of pass1aResults) {
    if (br.failed) continue; // leaves every page in this batch as a hole — see _stitchDocumentGroups' fallback
    for (const p of br.pages) {
      perPage[br.batchIndex * batchSize + p.pageIndexInBatch] = {
        documentTypeGuess: p.documentTypeGuess,
        confidence: p.confidence || "low",
        continuesFromPrevious: p.continuesFromPreviousPage === true,
      };
    }
  }
  return perPage;
}

// ── Stitching — pure logic, no AI call. This is what makes the "batch
// boundary must never become a document boundary" and "every page ends in
// exactly one group or unrecognized_pages" invariants true by construction:
// the loop below visits every page index exactly once and always routes it
// to one of the two buckets, never skipping an index. ──
function _stitchDocumentGroups(perPageClassifications, seamVerdicts, batchSize, pageCount) {
  const groups = [];
  const unrecognizedPages = [];
  let current = null;
  // Loop bound is the true page count, passed explicitly — NOT
  // perPageClassifications.length. That array is sparse (a wholly-failed
  // Pass 1a batch leaves holes, see _flattenPass1a), and if the LAST batch
  // is the one that failed, nothing ever extends the array's .length that
  // far — using it as the bound would silently stop short of the real page
  // count, which is exactly the failure mode "no silent truncation" exists
  // to rule out.
  const total = typeof pageCount === "number" ? pageCount : perPageClassifications.length;

  for (let pageIndex = 0; pageIndex < total; pageIndex++) {
    const page = perPageClassifications[pageIndex];
    const classificationMissing = !page;
    const effectivePage = page || { documentTypeGuess: null, confidence: "low", continuesFromPrevious: false };
    const isFirstPageOfBundle = pageIndex === 0;
    const isFirstPageOfBatch = pageIndex % batchSize === 0;

    let continuesPrevious;
    if (isFirstPageOfBundle) {
      continuesPrevious = false;
    } else if (isFirstPageOfBatch) {
      const seamIndex = Math.floor(pageIndex / batchSize) - 1;
      const seam = seamVerdicts[seamIndex];
      // Missing data or UNCERTAIN never silently merges — treated as a
      // fresh candidate group so the review screen surfaces it explicitly,
      // rather than guessing continuity across a seam nobody was sure about.
      continuesPrevious = !!seam && seam.verdict === "SAME_DOCUMENT";
    } else {
      continuesPrevious = effectivePage.continuesFromPrevious === true;
    }

    const isRecognized = !classificationMissing && !!effectivePage.documentTypeGuess && effectivePage.documentTypeGuess !== "Unrecognized";

    if (!isRecognized) {
      if (current) { groups.push(current); current = null; }
      unrecognizedPages.push({
        pageIndex,
        reason: classificationMissing ? "classification_failed" : "unclassified_or_low_confidence",
        confidence: effectivePage.confidence,
        retryable: classificationMissing,
      });
      continue;
    }

    if (continuesPrevious && current && current.documentTypeGuess === page.documentTypeGuess) {
      current.pageIndexes.push(pageIndex);
      current.pageConfidences.push(page.confidence);
    } else {
      if (current) groups.push(current);
      current = {
        groupId: `grp_${String(groups.length).padStart(4, "0")}`,
        documentTypeGuess: page.documentTypeGuess,
        pageIndexes: [pageIndex],
        pageConfidences: [page.confidence],
      };
    }
  }
  if (current) groups.push(current);

  return { groups, unrecognizedPages };
}

// ── Pass 1c — global consistency (deterministic; per
// phase-1-implementation-plan.md §8, this is plain logic over already-
// extracted data, not a new AI call). Flags groups for mandatory review
// rather than attempting to auto-resolve — matches the explicit
// requirement: "if the intake process cannot reach a trustworthy grouping
// result, keep the session in review/error state rather than silently
// guessing." ──
function _summarizeConfidence(confidences) {
  if (confidences.includes("low")) return "low";
  if (confidences.includes("medium")) return "medium";
  return "high";
}
function _computeGlobalConsistency(groups, { maxPlausibleGroupPages = MAX_PLAUSIBLE_GROUP_PAGES } = {}) {
  return groups.map((g) => {
    const flags = [];
    if (g.pageConfidences.includes("low")) {
      flags.push({ type: "low_confidence_page_in_group", detail: "At least one page in this group was classified with low confidence." });
    }
    if (g.pageIndexes.length > maxPlausibleGroupPages) {
      flags.push({ type: "implausible_span", detail: `Group spans ${g.pageIndexes.length} pages, above the configured plausibility threshold of ${maxPlausibleGroupPages}.` });
    }
    return { ...g, consistencyFlags: flags, needsReview: flags.length > 0 };
  });
}

// ── Session CRUD (Supabase) ──
async function _createIntakeSession({ draftId, userId, pageCount }) {
  const { data, error } = await sb.from("intake_review_sessions").insert({
    draft_id: draftId, user_id: userId, status: "processing", page_count: pageCount,
    document_groups: [], unrecognized_pages: [], edit_log: [],
  }).select().single();
  if (error) throw new Error(`Failed to create intake session: ${error.message}`);
  return data;
}
async function _updateIntakeSession(sessionId, patch) {
  const { data, error } = await sb.from("intake_review_sessions").update(patch).eq("id", sessionId).select().single();
  if (error) throw new Error(`Failed to update intake session: ${error.message}`);
  return data;
}
async function getIntakeSession(sessionId) {
  const { data, error } = await sb.from("intake_review_sessions").select("*").eq("id", sessionId).single();
  if (error) throw new Error(`Failed to load intake session: ${error.message}`);
  return data;
}
async function listIntakeSessionsForDraft(draftId) {
  const { data, error } = await sb.from("intake_review_sessions").select("*").eq("draft_id", draftId).order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to list intake sessions: ${error.message}`);
  return data || [];
}
// Append-only edit log — never overwrites prior entries, matches the
// "never silently overwrite" discipline used elsewhere in this project
// (document field auto-fill merging, the Legal Intelligence registry).
async function _appendEditLog(session, entry) {
  const editLog = Array.isArray(session.edit_log) ? session.edit_log : [];
  const newLog = [...editLog, { ...entry, timestamp: new Date().toISOString() }];
  return _updateIntakeSession(session.id, { edit_log: newLog });
}

// ── Review-screen edit operations — each is reversible (undo = apply the
// inverse of its own edit_log entry) and auditable (before/after recorded). ──
// pageRange must be recomputed on every pageIndexes change, not carried over
// from whichever source group happened to be spread first — a stale range
// display would be a real, if cosmetic, bug in the review screen.
function _pageRangeOf(pageIndexes) {
  return [pageIndexes[0], pageIndexes[pageIndexes.length - 1]];
}

async function mergeGroups(session, groupIdA, groupIdB) {
  const groups = session.document_groups;
  const a = groups.find((g) => g.groupId === groupIdA);
  const b = groups.find((g) => g.groupId === groupIdB);
  if (!a || !b) throw new Error("One or both groups to merge were not found.");
  const pageIndexes = [...a.pageIndexes, ...b.pageIndexes].sort((x, y) => x - y);
  const merged = {
    ...a,
    pageIndexes,
    pageRange: _pageRangeOf(pageIndexes),
    sourceImageRefs: [...(a.sourceImageRefs || []), ...(b.sourceImageRefs || [])],
    status: "ready",
  };
  const newGroups = groups.filter((g) => g.groupId !== groupIdA && g.groupId !== groupIdB).concat(merged);
  const updated = await _updateIntakeSession(session.id, { document_groups: newGroups });
  return _appendEditLog(updated, { actor: "investigator", action: "merge", before: { groups: [a, b] }, after: { groups: [merged] } });
}

async function splitGroup(session, groupId, splitAtPageIndex) {
  const groups = session.document_groups;
  const g = groups.find((x) => x.groupId === groupId);
  if (!g) throw new Error("Group to split was not found.");
  const before = g.pageIndexes.filter((p) => p < splitAtPageIndex);
  const after = g.pageIndexes.filter((p) => p >= splitAtPageIndex);
  if (before.length === 0 || after.length === 0) throw new Error("Split point must fall strictly inside the group's page range.");
  const groupA = { ...g, groupId: `${g.groupId}a`, pageIndexes: before, pageRange: _pageRangeOf(before), status: "ready" };
  const groupB = { ...g, groupId: `${g.groupId}b`, pageIndexes: after, pageRange: _pageRangeOf(after), status: "ready" };
  const newGroups = groups.filter((x) => x.groupId !== groupId).concat([groupA, groupB]);
  const updated = await _updateIntakeSession(session.id, { document_groups: newGroups });
  return _appendEditLog(updated, { actor: "investigator", action: "split", before: { groups: [g] }, after: { groups: [groupA, groupB] } });
}

async function retypeGroup(session, groupId, newDocumentTypeKey) {
  const groups = session.document_groups;
  const g = groups.find((x) => x.groupId === groupId);
  if (!g) throw new Error("Group to retype was not found.");
  const before = { ...g };
  const retyped = { ...g, mappedDocCategory: newDocumentTypeKey, documentTypeId: newDocumentTypeKey, status: "ready" };
  const newGroups = groups.map((x) => (x.groupId === groupId ? retyped : x));
  const updated = await _updateIntakeSession(session.id, { document_groups: newGroups });
  return _appendEditLog(updated, { actor: "investigator", action: "retype", before: { group: before }, after: { group: retyped } });
}

// Assign an unrecognized page to a (new or existing) group, or explicitly
// confirm it stays unrecognized — either way it's a deliberate action, not
// a silent drop.
async function resolveUnrecognizedPage(session, pageIndex, { assignToGroupId, newDocumentTypeKey, keepUnrecognized } = {}) {
  const unrecognized = session.unrecognized_pages;
  const entry = unrecognized.find((u) => u.pageIndex === pageIndex);
  if (!entry) throw new Error("This page is not in the unrecognized list.");
  const remainingUnrecognized = unrecognized.filter((u) => u.pageIndex !== pageIndex);

  if (keepUnrecognized) {
    const updated = await _updateIntakeSession(session.id, {
      unrecognized_pages: unrecognized.map((u) => (u.pageIndex === pageIndex ? { ...u, confirmedUnrecognized: true } : u)),
    });
    return _appendEditLog(updated, { actor: "investigator", action: "confirm_unrecognized", before: { page: entry }, after: { page: { ...entry, confirmedUnrecognized: true } } });
  }

  let newGroups = session.document_groups;
  if (assignToGroupId) {
    newGroups = newGroups.map((g) => {
      if (g.groupId !== assignToGroupId) return g;
      const pageIndexes = [...g.pageIndexes, pageIndex].sort((a, b) => a - b);
      return { ...g, pageIndexes, pageRange: _pageRangeOf(pageIndexes), sourceImageRefs: [...(g.sourceImageRefs || []), entry.sourceImageRef] };
    });
  } else if (newDocumentTypeKey) {
    newGroups = newGroups.concat([{
      groupId: `grp_${String(newGroups.length).padStart(4, "0")}_manual`,
      documentTypeGuess: newDocumentTypeKey, mappedDocCategory: newDocumentTypeKey, documentTypeId: newDocumentTypeKey,
      pageIndexes: [pageIndex], pageRange: _pageRangeOf([pageIndex]), pageConfidences: ["manual"], sourceImageRefs: [entry.sourceImageRef], status: "ready",
    }]);
  } else {
    throw new Error("Must specify assignToGroupId, newDocumentTypeKey, or keepUnrecognized.");
  }
  const updated = await _updateIntakeSession(session.id, { document_groups: newGroups, unrecognized_pages: remainingUnrecognized });
  return _appendEditLog(updated, { actor: "investigator", action: "resolve_unrecognized", before: { page: entry }, after: { group: newGroups[newGroups.length - 1] } });
}

// Nothing writes to report_drafts.doc_categories until this is called —
// mirrors the same "AI proposes, human confirms" boundary already
// established for legal_intelligence.
async function confirmIntakeSession(session) {
  if (!session.document_groups.length && !session.unrecognized_pages.length) {
    throw new Error("Nothing to confirm — no document groups or unrecognized pages were produced.");
  }
  const updated = await _updateIntakeSession(session.id, { status: "confirmed", confirmed_at: new Date().toISOString() });
  return _appendEditLog(updated, { actor: "investigator", action: "confirm", before: { status: session.status }, after: { status: "confirmed" } });
}

// Fetch a confirmed group's rendered pages back from Storage as real File
// objects, ready to pass into AIService.autoFillDocument unchanged.
async function getGroupFiles(group) {
  const files = [];
  for (let i = 0; i < group.pageIndexes.length; i++) {
    const path = group.sourceImageRefs[i];
    const { data, error } = await sb.storage.from(INTAKE_STORAGE_BUCKET).download(path);
    if (error) throw new Error(`Failed to fetch page ${group.pageIndexes[i] + 1}: ${error.message}`);
    files.push(new File([data], `page-${group.pageIndexes[i] + 1}.jpg`, { type: "image/jpeg" }));
  }
  return files;
}

// ── Main orchestration ──
// docCategoriesVocab: [{key, title}, ...] — passed in by the caller
// (report.html), never referenced globally, so this file stays decoupled
// from DOC_CATEGORIES' definition — the same decoupling AIService itself
// already uses for docsText.
async function processIntake(file, { draftId, userId, docCategoriesVocab, onProgress, onStatus } = {}) {
  // Ceiling check happens before any session row, any upload, any AI call —
  // the cheapest possible rejection point, and what makes "do not partially
  // create a review session" true for an oversized PDF.
  const { pageCount, images } = await _renderAllPages(file, { onProgress });

  const session = await _createIntakeSession({ draftId, userId, pageCount });
  try {
    const storagePaths = [];
    for (const img of images) {
      storagePaths[img.pageIndex] = await _uploadPageImage(session.id, img.pageIndex, img.dataUrl);
      if (onProgress) onProgress({ stage: "uploading", uploaded: img.pageIndex + 1, total: pageCount });
    }

    // Per-batch/per-seam failure isolation: each call is caught individually
    // rather than left to reject the shared Promise.all, so one failed batch
    // (after the existing retry contract is exhausted) cannot corrupt or
    // abort unrelated batches — matches getLegalIntelligence()'s existing
    // per-module independence guarantee, applied per-batch here. A failed
    // batch's pages land in unrecognized_pages with reason
    // "classification_failed" (retryable: true), distinct from the AI
    // genuinely saying "Unrecognized" — see _stitchDocumentGroups.
    const batches = _sliceIntoBatches(images, INTAKE_BATCH_SIZE);
    const pass1aResults = await Promise.all(batches.map((batch, batchIndex) =>
      _computePass1a({ images: batch.map((p) => p.dataUrl), docCategoriesVocab }, { onStatus })
        .then((pages) => ({ batchIndex, pages }))
        .catch((e) => ({ batchIndex, pages: [], failed: true, error: e.message || String(e) }))
    ));

    const seamCount = Math.max(0, batches.length - 1);
    const seamResults = await Promise.all(Array.from({ length: seamCount }, (_, seamIndex) => {
      const contextImages = _buildSeamContext(images, seamIndex, INTAKE_BATCH_SIZE, SEAM_CONTEXT_WINDOW);
      return _computePass1b({ images: contextImages }, { onStatus })
        .then((r) => ({ seamIndex, ...r }))
        // A failed seam call degrades to the same safe default as an
        // explicit UNCERTAIN verdict — never silently merges across a seam
        // that couldn't be evaluated at all.
        .catch((e) => ({ seamIndex, verdict: "UNCERTAIN", confidence: "low", evidence: [], failed: true, error: e.message || String(e) }));
    }));

    const perPageClassifications = _flattenPass1a(pass1aResults, INTAKE_BATCH_SIZE);
    const { groups, unrecognizedPages } = _stitchDocumentGroups(perPageClassifications, seamResults, INTAKE_BATCH_SIZE, pageCount);
    const groupsWithConsistency = _computeGlobalConsistency(groups);

    const documentGroups = groupsWithConsistency.map((g) => {
      const mapped = docCategoriesVocab.find((c) => c.title === g.documentTypeGuess);
      return {
        groupId: g.groupId,
        pageRange: [g.pageIndexes[0], g.pageIndexes[g.pageIndexes.length - 1]],
        pageIndexes: g.pageIndexes,
        documentTypeId: g.documentTypeGuess,
        // Defensive: if the AI produced a title that doesn't resolve to a
        // real category (hallucination), this group is still flagged for
        // review rather than silently mapped to nothing.
        mappedDocCategory: mapped ? mapped.key : null,
        confidence: _summarizeConfidence(g.pageConfidences),
        sourceImageRefs: g.pageIndexes.map((pi) => storagePaths[pi]),
        status: g.needsReview || !mapped ? "needs_review" : "ready",
        consistencyFlags: mapped ? g.consistencyFlags : [...g.consistencyFlags, { type: "unmapped_category", detail: `AI-guessed type "${g.documentTypeGuess}" does not match any known document category.` }],
      };
    });
    const unrecognized = unrecognizedPages.map((u) => ({ ...u, sourceImageRef: storagePaths[u.pageIndex] }));

    if (documentGroups.length === 0 && unrecognized.length !== pageCount) {
      // Should be structurally impossible given _stitchDocumentGroups' own
      // invariant, but this is exactly the "cannot reach a trustworthy
      // result" case the error-handling requirement names — never guess.
      return _updateIntakeSession(session.id, { status: "error", error_message: "Could not account for every page after classification. Left in error state rather than guessing." });
    }

    return _updateIntakeSession(session.id, {
      status: "ready_for_review",
      document_groups: documentGroups,
      unrecognized_pages: unrecognized,
    });
  } catch (e) {
    // Per-session failure isolation: an intake that fails partway through
    // is left in an explicit, visible error state — never silently
    // discarded, never guessed into a false "ready_for_review".
    await _updateIntakeSession(session.id, { status: "error", error_message: e.message || String(e) }).catch(() => {});
    throw e;
  }
}

// ── Public interface ──
const IntakeService = {
  configure({ pageCeiling, concurrencyLimit } = {}) {
    if (typeof pageCeiling === "number" && pageCeiling > 0) _pageCeiling = pageCeiling;
    if (typeof concurrencyLimit === "number" && concurrencyLimit > 0) _concurrencyLimit = concurrencyLimit;
  },
  getConfig() { return { pageCeiling: _pageCeiling, batchSize: INTAKE_BATCH_SIZE, concurrencyLimit: _concurrencyLimit }; },
  getConcurrencyStatus: _getConcurrencyStatus,

  processIntake,
  getIntakeSession,
  listIntakeSessionsForDraft,
  mergeGroups,
  splitGroup,
  retypeGroup,
  resolveUnrecognizedPage,
  confirmIntakeSession,
  getGroupFiles,
  getSignedPageUrl: _getSignedPageUrl,

  // Exposed for the automated test suite only — not part of the UI-facing
  // contract, but pure logic worth testing directly and in isolation from
  // network/Storage/session state.
  _internal: {
    stitchDocumentGroups: _stitchDocumentGroups,
    computeGlobalConsistency: _computeGlobalConsistency,
    sliceIntoBatches: _sliceIntoBatches,
    buildSeamContext: _buildSeamContext,
    flattenPass1a: _flattenPass1a,
    dataUrlToImagePayload: _dataUrlToImagePayload,
  },
};
