// ============================================================
// Tests — Combined PDF Intake Pipeline (Phase 1)
// ============================================================
// Run: node tests/test-intake-pipeline.js
// Covers the 18 scenarios named in the Phase 1 implementation directive.
// Part A tests IntakeService._internal's pure logic directly (no network/
// Storage/PDF mocking needed — the most reliable layer to test exhaustively).
// Part B tests processIntake() end-to-end through the full vm harness
// (fake pdf.js, fake Supabase table+storage, fake AI responses).

const { loadIntakeService, fakeVisionResponse, fakeErrorResponse, fakePdfFile, test, assert, assertArrayEqual, summary } = require("./intake-vm-harness");

const DOC_CATEGORIES_VOCAB = [
  { key: "fir", title: "FIR Details" },
  { key: "mlcMedical", title: "MLC & Medical / Injury Details" },
  { key: "dischargeSummary", title: "Discharge Summary" },
];

function page(documentTypeGuess, confidence = "high", continuesFromPrevious = false) {
  return { documentTypeGuess, confidence, continuesFromPrevious };
}

async function run() {
  const { IntakeService } = loadIntakeService({ pageCount: 1 });
  const I = IntakeService._internal;

  // ── Part A: pure stitching/consistency logic ──

  // 1 & 2. Batch sizing at 1-20 pages and 21+ pages.
  await test("1-20 page PDF: single batch, no seams", () => {
    const batches = I.sliceIntoBatches(Array.from({ length: 15 }, (_, i) => ({ pageIndex: i })), 20);
    assert(batches.length === 1, `expected 1 batch, got ${batches.length}`);
    assert(batches[0].length === 15, "batch should contain all 15 pages");
  });
  await test("21+ page PDF: multiple batches, at least 1 seam", () => {
    const batches = I.sliceIntoBatches(Array.from({ length: 45 }, (_, i) => ({ pageIndex: i })), 20);
    assert(batches.length === 3, `expected 3 batches (20+20+5), got ${batches.length}`);
    const seamCount = batches.length - 1;
    assert(seamCount === 2, `expected 2 seams, got ${seamCount}`);
  });

  // 3. Document crossing a 20-page batch boundary — SAME_DOCUMENT seam
  // verdict must keep it as one group, never split at the batch line.
  await test("document crossing a batch boundary stays one group when the seam says SAME_DOCUMENT", () => {
    const perPage = [];
    for (let i = 0; i < 25; i++) perPage[i] = page("FIR Details", "high", i > 0 && i !== 20);
    const seams = [{ seamIndex: 0, verdict: "SAME_DOCUMENT", confidence: "high" }];
    const { groups, unrecognizedPages } = I.stitchDocumentGroups(perPage, seams, 20, 25);
    assert(groups.length === 1, `expected 1 group spanning the boundary, got ${groups.length}`);
    assertArrayEqual(groups[0].pageIndexes, Array.from({ length: 25 }, (_, i) => i), "group should contain all 25 pages in order");
    assert(unrecognizedPages.length === 0, "no pages should be unrecognized");
  });
  await test("batch boundary with NEW_DOCUMENT seam verdict correctly splits into two groups", () => {
    const perPage = [];
    for (let i = 0; i < 25; i++) perPage[i] = page(i < 20 ? "FIR Details" : "MLC & Medical / Injury Details", "high", i > 0 && i !== 20);
    const seams = [{ seamIndex: 0, verdict: "NEW_DOCUMENT", confidence: "high" }];
    const { groups } = I.stitchDocumentGroups(perPage, seams, 20, 25);
    assert(groups.length === 2, `expected 2 groups, got ${groups.length}`);
    assertArrayEqual(groups[0].pageIndexes, Array.from({ length: 20 }, (_, i) => i));
    assertArrayEqual(groups[1].pageIndexes, Array.from({ length: 5 }, (_, i) => i + 20));
  });
  await test("UNCERTAIN seam verdict never silently merges — starts a new candidate group instead", () => {
    const perPage = [];
    for (let i = 0; i < 25; i++) perPage[i] = page("FIR Details", "high", i > 0 && i !== 20);
    const seams = [{ seamIndex: 0, verdict: "UNCERTAIN", confidence: "low" }];
    const { groups } = I.stitchDocumentGroups(perPage, seams, 20, 25);
    assert(groups.length === 2, `UNCERTAIN must not merge across the seam, expected 2 groups, got ${groups.length}`);
  });

  // 4. Multiple documents crossing multiple batch boundaries.
  await test("multiple documents crossing multiple batch boundaries", () => {
    // 3 batches (20+20+10 = 50 pages). Doc A: 0-24 (crosses seam 0).
    // Doc B: 25-39 (within batch 2, doesn't cross a seam). Doc C: 40-49 (crosses seam 1).
    const perPage = [];
    for (let i = 0; i < 50; i++) {
      let type;
      if (i < 25) type = "FIR Details";
      else if (i < 40) type = "MLC & Medical / Injury Details";
      else type = "Discharge Summary";
      const continues = i === 0 ? false : (i % 20 === 0 ? null : true); // seam pages resolved below
      perPage[i] = page(type, "high", continues === null ? false : continues);
    }
    const seams = [
      { seamIndex: 0, verdict: "SAME_DOCUMENT", confidence: "high" }, // page 20 continues Doc A (0-24)
      { seamIndex: 1, verdict: "NEW_DOCUMENT", confidence: "high" },  // page 40 starts Doc C
    ];
    const { groups, unrecognizedPages } = I.stitchDocumentGroups(perPage, seams, 20, 50);
    assert(groups.length === 3, `expected 3 groups, got ${groups.length}`);
    assertArrayEqual(groups[0].pageIndexes, Array.from({ length: 25 }, (_, i) => i), "Doc A should span 0-24 across the first seam");
    assertArrayEqual(groups[1].pageIndexes, Array.from({ length: 15 }, (_, i) => i + 25), "Doc B should span 25-39");
    assertArrayEqual(groups[2].pageIndexes, Array.from({ length: 10 }, (_, i) => i + 40), "Doc C should span 40-49 after the second seam");
    assert(unrecognizedPages.length === 0, "no pages should be unrecognized in this scenario");
  });

  // 5. Mixed document types.
  await test("mixed document types land in separate groups", () => {
    const perPage = [page("FIR Details"), page("MLC & Medical / Injury Details"), page("Discharge Summary")];
    const { groups } = I.stitchDocumentGroups(perPage, [], 20, 3);
    assert(groups.length === 3, `expected 3 separate single-page groups, got ${groups.length}`);
  });

  // 6. Poor-quality scan -> low confidence flagged for review, not silently accepted.
  await test("poor-quality scan (low confidence) flags the group for review via Pass 1c", () => {
    const perPage = [page("FIR Details", "high"), page("FIR Details", "low", true)];
    const { groups } = I.stitchDocumentGroups(perPage, [], 20, 2);
    const flagged = I.computeGlobalConsistency(groups);
    assert(flagged[0].needsReview === true, "group containing a low-confidence page should be flagged needsReview");
    assert(flagged[0].consistencyFlags.some((f) => f.type === "low_confidence_page_in_group"), "missing low_confidence_page_in_group flag");
  });
  await test("implausible span (Pass 1c) flags an oversized group", () => {
    const perPage = Array.from({ length: 45 }, () => page("FIR Details", "high", true));
    perPage[0].continuesFromPrevious = false;
    const { groups } = I.stitchDocumentGroups(perPage, [], 100, 45); // single batch, no seams, all "continues"
    const flagged = I.computeGlobalConsistency(groups, { maxPlausibleGroupPages: 40 });
    assert(flagged[0].needsReview === true, "45-page single group should exceed the 40-page plausibility threshold");
    assert(flagged[0].consistencyFlags.some((f) => f.type === "implausible_span"), "missing implausible_span flag");
  });

  // 7. Unrecognized pages.
  await test("AI-reported Unrecognized page lands in unrecognized_pages, not a group", () => {
    const perPage = [page("FIR Details"), page("Unrecognized", "low"), page("FIR Details")];
    const { groups, unrecognizedPages } = I.stitchDocumentGroups(perPage, [], 20, 3);
    assert(unrecognizedPages.length === 1 && unrecognizedPages[0].pageIndex === 1, "middle page should be unrecognized");
    assert(groups.length === 2, "the unrecognized page should split the surrounding pages into two groups, not one");
  });

  // 15. Hard invariant: every accepted page belongs to exactly one group or unrecognized_pages.
  await test("HARD INVARIANT: every page index appears in exactly one group or unrecognized_pages, never neither/both", () => {
    const total = 47;
    const perPage = [];
    for (let i = 0; i < total; i++) {
      const isUnrecognized = i % 7 === 0 && i !== 0;
      perPage[i] = isUnrecognized ? page("Unrecognized", "low") : page(i < 25 ? "FIR Details" : "MLC & Medical / Injury Details", "medium", i > 0 && i % 20 !== 0);
    }
    const seams = [{ seamIndex: 0, verdict: "UNCERTAIN" }, { seamIndex: 1, verdict: "SAME_DOCUMENT" }];
    const { groups, unrecognizedPages } = I.stitchDocumentGroups(perPage, seams, 20, total);
    const seen = new Map();
    for (const g of groups) for (const p of g.pageIndexes) seen.set(p, (seen.get(p) || 0) + 1);
    for (const u of unrecognizedPages) seen.set(u.pageIndex, (seen.get(u.pageIndex) || 0) + 1);
    for (let i = 0; i < total; i++) {
      assert(seen.has(i), `page ${i} is missing from both groups and unrecognized_pages`);
      assert(seen.get(i) === 1, `page ${i} appears ${seen.get(i)} times, expected exactly 1`);
    }
    assert(seen.size === total, `accounted for ${seen.size} distinct pages, expected ${total}`);
  });

  // 16. No silent truncation — a wholly-failed LAST batch must not shrink the
  // effective page count (this is the exact bug found and fixed during
  // implementation: perPageClassifications.length as a loop bound would
  // undershoot when the final batch's classification is missing).
  await test("no silent truncation: a missing/failed final batch's pages still land in unrecognized_pages, loop bound uses true pageCount", () => {
    const perPage = []; // batch 2 (pages 20-24) never got written — simulates a fully-failed final batch
    for (let i = 0; i < 20; i++) perPage[i] = page("FIR Details", "high", i > 0);
    const { groups, unrecognizedPages } = I.stitchDocumentGroups(perPage, [{ seamIndex: 0, verdict: "UNCERTAIN" }], 20, 25);
    assert(groups.length === 1 && groups[0].pageIndexes.length === 20, "first batch's 20 pages should form one group");
    assert(unrecognizedPages.length === 5, `expected the 5 pages from the failed final batch to land in unrecognized_pages, got ${unrecognizedPages.length}`);
    assert(unrecognizedPages.every((u) => u.reason === "classification_failed" && u.retryable === true), "failed-batch pages must be marked classification_failed and retryable, distinct from a genuine AI 'Unrecognized' verdict");
  });

  await test("dataUrlToImagePayload extracts mediaType and base64 data correctly", () => {
    const payload = I.dataUrlToImagePayload("data:image/jpeg;base64,QUJD");
    assert(payload.mediaType === "image/jpeg", `unexpected mediaType: ${payload.mediaType}`);
    assert(payload.data === "QUJD", `unexpected data: ${payload.data}`);
  });

  await test("buildSeamContext windows around the correct boundary page", () => {
    const images = Array.from({ length: 30 }, (_, i) => ({ pageIndex: i, dataUrl: `p${i}` }));
    const ctx = I.buildSeamContext(images, 0, 20, 3); // seam 0 = boundary at page 20
    assertArrayEqual(ctx, ["p17", "p18", "p19", "p20", "p21", "p22"], "seam context window is wrong");
  });

  // ── Part B: processIntake end-to-end (full harness: fake pdf.js, fake
  // Supabase table + storage, fake AI responses) ──

  // 13 & 14. Page ceiling — exactly at ceiling passes through to rendering;
  // above ceiling rejects explicitly, before any session row is created.
  await test("PDF exactly at the configured ceiling (300 pages) is NOT rejected", async () => {
    const { IntakeService: svc } = loadIntakeService({ pageCount: 300, fetchImpl: fakeVisionResponse({ pages: [] }) });
    svc.configure({ pageCeiling: 300 });
    // Rendering 300 real fake pages is slow only in wall-clock terms, not
    // logic — this exercises the real _renderAllPages loop, not a stub.
    const session = await svc.processIntake(fakePdfFile(), { draftId: "d1", userId: "u1", docCategoriesVocab: DOC_CATEGORIES_VOCAB });
    assert(session.status !== "error" || !/exceeds the configured ceiling/.test(session.error_message || ""), "a 300-page PDF must not be rejected for exceeding a 300-page ceiling");
  });
  await test("PDF above the configured ceiling is explicitly rejected — no session row, no AI calls", async () => {
    const { IntakeService: svc, calls, tableRows } = loadIntakeService({ pageCount: 301 });
    svc.configure({ pageCeiling: 300 });
    let threw = null;
    try { await svc.processIntake(fakePdfFile(), { draftId: "d1", userId: "u1", docCategoriesVocab: DOC_CATEGORIES_VOCAB }); }
    catch (e) { threw = e; }
    assert(threw && threw.code === "PAGE_CEILING_EXCEEDED", "expected an explicit PAGE_CEILING_EXCEEDED rejection");
    assert(threw.pageCount === 301 && threw.ceiling === 300, "rejection should name both the actual and configured page counts");
    assert(tableRows.length === 0, `expected zero intake_review_sessions rows created, got ${tableRows.length}`);
    assert(calls.length === 0, `expected zero AI calls, got ${calls.length}`);
  });

  // 9, 10, 11, 12. Merge/split/retype, each reversible-via-edit_log and auditable.
  await test("merge operation combines two groups, recomputes pageRange, and appends an auditable edit_log entry", async () => {
    const session = {
      id: "sess_1", document_groups: [
        { groupId: "g0", pageIndexes: [0, 1], pageRange: [0, 1], pageConfidences: ["high", "high"], sourceImageRefs: ["p0", "p1"], mappedDocCategory: "fir" },
        { groupId: "g1", pageIndexes: [2, 3], pageRange: [2, 3], pageConfidences: ["high", "high"], sourceImageRefs: ["p2", "p3"], mappedDocCategory: "fir" },
      ], unrecognized_pages: [], edit_log: [],
    };
    const { IntakeService: svc } = loadIntakeService({ tableRows: [session] });
    const updated = await svc.mergeGroups(session, "g0", "g1");
    assert(updated.document_groups.length === 1, "should have exactly 1 group after merging 2");
    assertArrayEqual(updated.document_groups[0].pageIndexes, [0, 1, 2, 3]);
    assertArrayEqual(updated.document_groups[0].pageRange, [0, 3], "pageRange must be recomputed after merge, not carried over stale from group A");
    assert(updated.edit_log.length === 1 && updated.edit_log[0].action === "merge", "expected one auditable merge edit_log entry");
    assert(updated.edit_log[0].before && updated.edit_log[0].after, "edit_log entry must record before/after for reversibility");
  });

  await test("split operation divides a group at the given page and recomputes both pageRanges", async () => {
    const session = {
      id: "sess_1", document_groups: [
        { groupId: "g0", pageIndexes: [0, 1, 2, 3, 4], pageRange: [0, 4], pageConfidences: ["high", "high", "high", "high", "high"], sourceImageRefs: ["p0", "p1", "p2", "p3", "p4"], mappedDocCategory: "fir" },
      ], unrecognized_pages: [], edit_log: [],
    };
    const { IntakeService: svc } = loadIntakeService({ tableRows: [session] });
    const updated = await svc.splitGroup(session, "g0", 3);
    assert(updated.document_groups.length === 2, "expected 2 groups after split");
    const [a, b] = updated.document_groups;
    assertArrayEqual(a.pageIndexes, [0, 1, 2]); assertArrayEqual(a.pageRange, [0, 2], "first half's pageRange must be recomputed");
    assertArrayEqual(b.pageIndexes, [3, 4]); assertArrayEqual(b.pageRange, [3, 4], "second half's pageRange must be recomputed");
    assert(updated.edit_log[0].action === "split", "expected an auditable split edit_log entry");
  });

  await test("retype operation (investigator correcting a classification) updates mappedDocCategory and logs the change", async () => {
    const session = { id: "sess_1", document_groups: [{ groupId: "g0", pageIndexes: [0], pageRange: [0, 0], mappedDocCategory: "fir", sourceImageRefs: ["p0"] }], unrecognized_pages: [], edit_log: [] };
    const { IntakeService: svc } = loadIntakeService({ tableRows: [session] });
    const updated = await svc.retypeGroup(session, "g0", "dischargeSummary");
    assert(updated.document_groups[0].mappedDocCategory === "dischargeSummary", "retype should update mappedDocCategory");
    assert(updated.edit_log[0].action === "retype", "expected an auditable retype edit_log entry");
    assert(updated.edit_log[0].before.group.mappedDocCategory === "fir", "before-state should record the original category, for reversibility");
  });

  await test("reversible/auditable review edits: edit_log is append-only across multiple edits, never overwritten", async () => {
    let session = { id: "sess_1", document_groups: [{ groupId: "g0", pageIndexes: [0], pageRange: [0, 0], mappedDocCategory: "fir", sourceImageRefs: ["p0"] }], unrecognized_pages: [], edit_log: [] };
    const { IntakeService: svc } = loadIntakeService({ tableRows: [session] });
    session = await svc.retypeGroup(session, "g0", "mlcMedical");
    session = await svc.retypeGroup(session, "g0", "dischargeSummary");
    assert(session.edit_log.length === 2, `expected 2 accumulated edit_log entries, got ${session.edit_log.length}`);
    assert(session.edit_log[0].after.group.mappedDocCategory === "mlcMedical" && session.edit_log[1].before.group.mappedDocCategory === "mlcMedical", "edit_log must preserve the full ordered history, not just the latest state");
  });

  // 17. Intake concurrency remains bounded.
  await test("intake concurrency remains bounded at the configured limit, not unbounded", async () => {
    let maxObservedConcurrency = 0;
    const { IntakeService: svc } = loadIntakeService({
      pageCount: 60, // 3 batches -> 3 Pass 1a calls, 2 seams -> 2 Pass 1b calls = 5 total AI calls
      fetchImpl: async () => {
        const status = svc.getConcurrencyStatus();
        maxObservedConcurrency = Math.max(maxObservedConcurrency, status.active);
        await new Promise((r) => setTimeout(r, 5)); // hold the "slot" briefly so overlap is observable
        return { ok: true, status: 200, json: async () => ({ content: JSON.stringify({ pages: [], verdict: "SAME_DOCUMENT", confidence: "high", evidence: [] }), stop_reason: "end_turn" }), text: async () => "{}" };
      },
    });
    svc.configure({ concurrencyLimit: 2 });
    await svc.processIntake(fakePdfFile(), { draftId: "d1", userId: "u1", docCategoriesVocab: DOC_CATEGORIES_VOCAB });
    assert(maxObservedConcurrency <= 2, `observed concurrency ${maxObservedConcurrency} exceeded the configured limit of 2`);
    assert(maxObservedConcurrency >= 1, "sanity check: at least one call should have been observed as active");
  });
  await test("concurrency limit is configurable at runtime, not hardcoded", () => {
    const { IntakeService: svc } = loadIntakeService({});
    svc.configure({ concurrencyLimit: 7 });
    assert(svc.getConfig().concurrencyLimit === 7, "configure() should update the effective concurrency limit");
    svc.configure({ concurrencyLimit: 3 });
    assert(svc.getConfig().concurrencyLimit === 3, "configure() should be callable again with a different value");
  });

  // Per-batch failure isolation, directly through processIntake (backend
  // error on exactly one batch must not abort the whole session).
  await test("a single failed batch (after retries) does not abort or corrupt the rest of the session", async () => {
    let n = 0;
    const { IntakeService: svc } = loadIntakeService({
      pageCount: 40, // 2 batches, 1 seam
      fetchImpl: async () => {
        n++;
        // Concurrency is forced to 1 below so call order deterministically
        // means enqueue order: call 1 = batch 0 (fails), call 2 = batch 1
        // (Pass 1a, must classify all 20 of its pages or the unclassified
        // remainder would ALSO land in unrecognized_pages — not because
        // anything failed, just because the fixture didn't answer for
        // them), call 3 = the one seam (Pass 1b).
        if (n === 1) return fakeErrorResponse(500)();
        if (n === 2) return fakeVisionResponse({ pages: Array.from({ length: 20 }, (_, i) => ({ pageIndexInBatch: i, documentTypeGuess: "FIR Details", confidence: "high", continuesFromPreviousPage: i > 0 })) })();
        return fakeVisionResponse({ verdict: "UNCERTAIN", confidence: "low", evidence: [] })();
      },
    });
    svc.configure({ concurrencyLimit: 1 });
    const session = await svc.processIntake(fakePdfFile(), { draftId: "d1", userId: "u1", docCategoriesVocab: DOC_CATEGORIES_VOCAB });
    assert(session.status === "ready_for_review", `a single batch failure must not abort the session; got status ${session.status}`);
    const failedPages = (session.unrecognized_pages || []).filter((p) => p.reason === "classification_failed");
    assert(failedPages.length === 20, `expected the 20 pages from the failed batch to land in unrecognized_pages, got ${failedPages.length}`);
  });

  // Nothing writes to docCategories before explicit confirmation — verified
  // at the contract level: confirmIntakeSession only flips status/confirmed_at
  // on intake_review_sessions, and never touches any other table.
  await test("confirming a session only updates intake_review_sessions — never writes to any other table", async () => {
    const session = { id: "sess_1", status: "ready_for_review", document_groups: [{ groupId: "g0", pageIndexes: [0], mappedDocCategory: "fir" }], unrecognized_pages: [], edit_log: [] };
    const { IntakeService: svc } = loadIntakeService({ tableRows: [session] });
    const updated = await svc.confirmIntakeSession(session);
    assert(updated.status === "confirmed", "status should flip to confirmed");
    assert(!!updated.confirmed_at, "confirmed_at should be set");
    // The fake sb.from() throws for any table other than intake_review_sessions
    // (see intake-vm-harness.js) — reaching this line without an exception is
    // itself the proof that only that one table was touched.
  });

  summary();
}

run();
