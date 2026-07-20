// ============================================================
// Tests — Investigation Decision Engine (v1.1)
// ============================================================
// Run: node tests/test-investigation-decision-engine.js
// Covers the 7 cases docs/legal-intelligence/testing-guide.md requires per
// module, adapted for a synthesis module (input is a `modules[]` array, not
// docsText), plus one Decision-Engine-specific case proving the "never reads
// raw documents" constraint is structurally true, not just asserted.

const { loadAIService, fakeCompletionResponse, fakeErrorResponse, test, assert, summary } = require("./vm-harness");

const REGISTRY_WITH_TIMELINE_AND_DECISION = [
  { module_id: "timelineIntelligence", module_label: "Timeline Intelligence" },
  { module_id: "investigationDecisionEngine", module_label: "Investigation Decision Engine" },
];

function fakeRawContentResponse(contentString, { status = 200 } = {}) {
  return async () => ({
    ok: status < 400, status,
    json: async () => ({ content: contentString, stop_reason: "end_turn" }),
    text: async () => contentString,
  });
}

async function run() {
  // ── 1. Normal case ──
  await test("normal case: synthesises a clean recommendation from resolved modules", async () => {
    const decisionJson = {
      executiveSummary: "The accident is corroborated by the timeline reconstruction.",
      decisionStatus: "Requires Further Investigation",
      keyFindings: [{ finding: "Accident date and location consistent with FIR.", supportingModules: ["Timeline Intelligence"] }],
      supportingEvidence: [{ point: "FIR-derived timeline has no gaps.", supportingModules: ["Timeline Intelligence"] }],
      contradictions: [], missingEvidence: [], investigatorRecommendations: [],
      furtherActionsRequired: [], humanReviewRequired: false, confidence: "medium",
    };
    // There's no public API to hand the decision engine a pre-resolved
    // modules array directly, so this exercises the real getLegalIntelligence()
    // path with docsText present — pass 1 computes Timeline for real, pass 2
    // feeds its resolved output to the decision engine.
    const { AIService: ai2, calls } = loadAIService({
      registryRows: REGISTRY_WITH_TIMELINE_AND_DECISION,
      fetchImpl: (() => {
        let n = 0;
        const timeline = fakeCompletionResponse({ events: [{ date: "15/03/2024", event: "Accident", source: "FIR" }], anomalies: [], confidence: "high" });
        const decision = fakeCompletionResponse(decisionJson);
        return async (...args) => (++n === 1 ? timeline() : decision());
      })(),
    });
    const result = await ai2.getLegalIntelligence({ docsText: "some FIR text" });
    const rec = result.modules.find((m) => m.moduleId === "investigationDecisionEngine");
    assert(rec.status === "Pending Verification", `expected Pending Verification, got ${rec.status}`);
    assert(rec.summary.startsWith("Decision Status: Requires Further Investigation."), `unexpected summary: ${rec.summary}`);
    assert(rec.details.includes("KEY FINDINGS:"), "details missing KEY FINDINGS section");
    assert(rec.details.includes("Timeline Intelligence"), "details doesn't cite Timeline Intelligence");
    assert(rec.confidence === "medium", `expected medium confidence, got ${rec.confidence}`);
    assert(rec.manualReview === false, "expected manualReview false");
    assert(Array.isArray(rec.references) && rec.references.includes("Timeline Intelligence"), "references should include Timeline Intelligence");
    assert(calls.length === 2, `expected 2 fetch calls (timeline + decision), got ${calls.length}`);
  });

  // ── 2. Flagged/discrepancy case ──
  await test("flagged case: contradictions surface with severity labels", async () => {
    const decisionJson = {
      executiveSummary: "A timing contradiction was found.",
      decisionStatus: "Requires Further Investigation",
      keyFindings: [], supportingEvidence: [],
      contradictions: [{ description: "FIR lodged before stated accident time.", severity: "high", supportingModules: ["Timeline Intelligence"] }],
      missingEvidence: [{ item: "TP driver statement", impact: "Cannot confirm the other party's account." }],
      investigatorRecommendations: [{ recommendation: "Obtain TP driver statement.", supportingModules: ["Timeline Intelligence"] }],
      furtherActionsRequired: [{ action: "Re-interview complainant.", priority: "high" }],
      humanReviewRequired: true, confidence: "low",
    };
    const registry = REGISTRY_WITH_TIMELINE_AND_DECISION;
    let n = 0;
    const timeline = fakeCompletionResponse({ events: [{ date: "15/03/2024", event: "Accident", source: "FIR" }], anomalies: [{ description: "FIR lodged before accident time", severity: "high" }], confidence: "medium" });
    const decision = fakeCompletionResponse(decisionJson);
    const { AIService: ai2 } = loadAIService({ registryRows: registry, fetchImpl: async () => (++n === 1 ? timeline() : decision()) });
    const result = await ai2.getLegalIntelligence({ docsText: "text" });
    const rec = result.modules.find((m) => m.moduleId === "investigationDecisionEngine");
    assert(rec.details.includes("[HIGH] FIR lodged before stated accident time"), `missing formatted contradiction: ${rec.details}`);
    assert(rec.details.includes("MISSING EVIDENCE:"), "missing MISSING EVIDENCE section");
    assert(rec.details.includes("[HIGH] Re-interview complainant."), "missing formatted further action");
    assert(rec.manualReview === true, "expected manualReview true for a flagged case");
  });

  // ── 3. Zero-data empty state (the cost guard) ──
  await test("zero-data case: all other modules still placeholders -> Not Performed, zero AI calls", async () => {
    const registry = REGISTRY_WITH_TIMELINE_AND_DECISION;
    const { AIService, calls } = loadAIService({ registryRows: registry, fetchImpl: fakeCompletionResponse({}) });
    // No docsText at all -> pass 1 resolves Timeline as a placeholder too,
    // so the decision engine has nothing usable to synthesise from.
    const result = await AIService.getLegalIntelligence({ docsText: null });
    const rec = result.modules.find((m) => m.moduleId === "investigationDecisionEngine");
    assert(rec.status === "Not Performed", `expected Not Performed, got ${rec.status}`);
    assert(Array.isArray(rec.evidence) && rec.evidence.length === 0, "evidence should be [], not null/missing");
    assert(Array.isArray(rec.references) && rec.references.length === 0, "references should be [], not null/missing");
    assert(calls.length === 0, `expected zero fetch calls when nothing is usable, got ${calls.length}`);
  });

  // ── 4. Malformed JSON ──
  await test("malformed JSON from AI -> degrades to placeholder, does not throw past dispatch", async () => {
    const registry = REGISTRY_WITH_TIMELINE_AND_DECISION;
    let n = 0;
    const timeline = fakeCompletionResponse({ events: [{ date: "15/03/2024", event: "Accident", source: "FIR" }], anomalies: [], confidence: "high" });
    const malformed = fakeRawContentResponse("not valid json {{{");
    const { AIService } = loadAIService({ registryRows: registry, fetchImpl: async () => (++n === 1 ? timeline() : malformed()) });
    const result = await AIService.getLegalIntelligence({ docsText: "text" });
    const rec = result.modules.find((m) => m.moduleId === "investigationDecisionEngine");
    assert(rec.status === "Not Performed", `expected graceful fallback to Not Performed, got ${rec.status}`);
    // Sibling module must be unaffected by the decision engine's failure.
    const timelineRec = result.modules.find((m) => m.moduleId === "timelineIntelligence");
    assert(timelineRec.status === "Pending Verification", "sibling module should be unaffected by decision engine failure");
  });

  // ── 5. Wrong-type JSON ──
  await test("wrong-type JSON fields -> Array.isArray guards recover, no crash", async () => {
    const registry = [{ module_id: "investigationDecisionEngine", module_label: "Investigation Decision Engine" }, { module_id: "timelineIntelligence", module_label: "Timeline Intelligence" }];
    let n = 0;
    const timeline = fakeCompletionResponse({ events: [{ date: "15/03/2024", event: "Accident", source: "FIR" }], anomalies: [], confidence: "high" });
    // keyFindings/contradictions are strings instead of arrays -- off-spec.
    const wrongType = fakeCompletionResponse({
      executiveSummary: "ok", decisionStatus: "Sufficient Evidence",
      keyFindings: "not an array", contradictions: 42, missingEvidence: null,
      investigatorRecommendations: undefined, furtherActionsRequired: {},
      humanReviewRequired: false, confidence: "low",
    });
    const { AIService } = loadAIService({ registryRows: registry, fetchImpl: async () => (++n === 1 ? timeline() : wrongType()) });
    const result = await AIService.getLegalIntelligence({ docsText: "text" });
    const rec = result.modules.find((m) => m.moduleId === "investigationDecisionEngine");
    assert(rec.status === "Pending Verification", `expected graceful recovery, got status ${rec.status}`);
    assert(rec.summary.startsWith("Decision Status: Sufficient Evidence."), `unexpected summary: ${rec.summary}`);
    assert(Array.isArray(rec.references), "references must still be an array despite off-spec input");
  });

  // ── 6. Backend error ──
  await test("backend error (500) -> placeholder fallback", async () => {
    const registry = REGISTRY_WITH_TIMELINE_AND_DECISION;
    let n = 0;
    const timeline = fakeCompletionResponse({ events: [{ date: "15/03/2024", event: "Accident", source: "FIR" }], anomalies: [], confidence: "high" });
    const error500 = fakeErrorResponse(500, "Internal Server Error");
    const { AIService } = loadAIService({ registryRows: registry, fetchImpl: async () => (++n === 1 ? timeline() : error500()) });
    const result = await AIService.getLegalIntelligence({ docsText: "text" });
    const rec = result.modules.find((m) => m.moduleId === "investigationDecisionEngine");
    assert(rec.status === "Not Performed", `expected Not Performed after backend error, got ${rec.status}`);
  });

  // ── 7. Independence ──
  await test("independence: decision engine failing does not affect document modules, and vice versa", async () => {
    const registry = REGISTRY_WITH_TIMELINE_AND_DECISION;
    let n = 0;
    // Timeline itself fails (malformed), decision engine would otherwise succeed.
    const timelineFails = fakeRawContentResponse("{{{not json");
    const decisionOk = fakeCompletionResponse({
      executiveSummary: "ok", decisionStatus: "Insufficient Evidence", keyFindings: [], supportingEvidence: [],
      contradictions: [], missingEvidence: [], investigatorRecommendations: [], furtherActionsRequired: [],
      humanReviewRequired: false, confidence: "low",
    });
    const { AIService } = loadAIService({ registryRows: registry, fetchImpl: async () => (++n === 1 ? timelineFails() : decisionOk()) });
    const result = await AIService.getLegalIntelligence({ docsText: "text" });
    const timelineRec = result.modules.find((m) => m.moduleId === "timelineIntelligence");
    assert(timelineRec.status === "Not Performed", "timeline should have degraded to placeholder");
    assert(result.modules.length === 2, `expected 2 modules total (independence: total count unchanged), got ${result.modules.length}`);
    // Note: with Timeline failed, it resolves as Not Performed BEFORE pass 2
    // runs, so the decision engine correctly sees nothing usable and should
    // itself short-circuit to a placeholder too (zero-data case) -- not a
    // second AI call. This is the expected, honest behaviour: with zero
    // real module output, there is nothing to synthesise, regardless of why.
    const decisionRec = result.modules.find((m) => m.moduleId === "investigationDecisionEngine");
    assert(decisionRec.status === "Not Performed", `expected decision engine to also have nothing to synthesise, got ${decisionRec.status}`);
    assert(n === 1, `expected only 1 fetch call (timeline) since decision engine had nothing usable, got ${n}`);
  });

  // ── 8. Decision-Engine-specific: never reads raw documents ──
  await test("never reads raw documents: decision engine's own prompt never contains docsText", async () => {
    const registry = REGISTRY_WITH_TIMELINE_AND_DECISION;
    const SECRET = "SECRET-RAW-DOCUMENT-TEXT-MARKER-12345";
    let n = 0;
    const timeline = fakeCompletionResponse({ events: [{ date: "15/03/2024", event: "Accident", source: "FIR" }], anomalies: [], confidence: "high" });
    const decision = fakeCompletionResponse({
      executiveSummary: "ok", decisionStatus: "Sufficient Evidence", keyFindings: [], supportingEvidence: [],
      contradictions: [], missingEvidence: [], investigatorRecommendations: [], furtherActionsRequired: [],
      humanReviewRequired: false, confidence: "high",
    });
    const { AIService, calls } = loadAIService({ registryRows: registry, fetchImpl: async () => (++n === 1 ? timeline() : decision()) });
    await AIService.getLegalIntelligence({ docsText: `FIR text: ${SECRET}` });
    assert(calls.length === 2, `expected 2 calls, got ${calls.length}`);
    assert(calls[0].body.prompt.includes(SECRET), "sanity check: the FIRST (document) call SHOULD contain docsText");
    assert(!calls[1].body.prompt.includes(SECRET), "FAIL: the decision engine's own prompt contained raw document text");
  });

  summary();
}

run();
