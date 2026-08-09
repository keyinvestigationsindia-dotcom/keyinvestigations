// ============================================================
// Tests — Health Claim medical-report accuracy fix
// ============================================================
// Run: node tests/test-health-claim-accuracy.js
// Covers the 15 test items required for the Health Claim accuracy fix
// (targeted response to the DEMO0001 case: patient identity/diagnosis
// hallucination, motor/MACT-flavored report prompt applied to a Health
// Claim, omitted pharmacy bills, uncertain handwriting stated as fact).
//
// Scope note on what a prompt-level unit test can and cannot prove: these
// tests verify (a) the PROMPT TEXT sent to the AI carries the required
// instructions, and (b) the EXTRACTION CONTRACT (autoFillDocument's return
// shape) faithfully passes through both a correct value and an explicit
// "Unclear / requires human verification" value without corrupting either.
// They cannot force a live model's actual handwriting judgment — that
// depends on the real /ki/vision backend, which these tests don't call.

const { loadAIService, fakeCompletionResponse, test, assert, summary } = require("./vm-harness");
const fs = require("fs");
const path = require("path");

const BASE_CASE_DATA = {
  claimNo: "TEST0001", court: "", claimAmount: "", doa: "", ivVehicle: "",
  insured: "", policyNo: "", policyPeriod: "",
};

const DISCHARGE_SUMMARY_CATEGORY = {
  key: "dischargeSummary", title: "Discharge Summary",
  fields: [
    { key: "hospital", label: "Hospital name & address" },
    { key: "admissionDate", label: "Date of admission" },
    { key: "dischargeDate", label: "Date of discharge" },
    { key: "diagnosis", label: "Diagnosis / reason for admission" },
    { key: "treatment", label: "Treatment given / procedures performed", area: true },
    { key: "conditionAtDischarge", label: "Condition at time of discharge" },
    { key: "narrative", label: "Other discharge summary details", area: true },
    { key: "remarks", label: "Remarks", area: true },
  ],
};

const PARTICULARS_CATEGORY = {
  key: "particulars", title: "Particulars of Deceased / Injured",
  fields: [{ key: "name", label: "Name" }, { key: "age", label: "Age" }, { key: "sex", label: "Sex" }],
};

async function generateReportPrompt(claimType, extraCaseData = {}, identityConflicts) {
  const { AIService: ai, calls: c } = loadAIService({ fetchImpl: fakeCompletionResponse({ sections: {}, redFlags: [], findings: "", observations: "", conclusion: "" }) });
  await ai.generateReport({
    caseData: { ...BASE_CASE_DATA, ...extraCaseData, claimType },
    docsText: "--- MLC & Medical / Injury Details ---\nHospital(s) name: Test Hospital",
    sectionKeys: "mlcMedical",
    extraNotes: "",
    identityConflicts,
  });
  return c[0].body.prompt;
}

async function run() {
  // ── 1. Health Claim prompt excludes MACT-specific report requirements ──
  await test("1. Health Claim report prompt excludes MACT-specific requirements (FIR reconstruction, vehicle/DL/permit verification, FIR-delay/chargesheet redFlags)", async () => {
    const prompt = await generateReportPrompt("Health Claim");
    const motorOnlyPhrases = [
      "Complete reconstruction from FIR, panchnama, DAR",
      "IV and TP vehicle details, RC, permit, fitness, DL, policy",
      "FIR delay — calculate exact days",
      "DL validity/class mismatch",
      "Permit/fitness expiry",
      "Pending/missing chargesheet",
      "Witness credibility — anyone who claims to be eyewitness",
    ];
    for (const phrase of motorOnlyPhrases) {
      assert(!prompt.includes(phrase), `Health Claim prompt must not contain motor-specific requirement: "${phrase}"`);
    }
    assert(prompt.includes("Patient/claimant identity"), "Health Claim prompt should contain the health-specific identity section");
    assert(!prompt.includes("Date of Accident:"), "Health Claim case header should omit Date of Accident");
    assert(!prompt.includes("Insured Vehicle:"), "Health Claim case header should omit Insured Vehicle");
  });

  // ── 2, 3, 4. MACT Death / MACT Injury / TPPD unchanged ──
  for (const claimType of ["MACT Death Claim", "MACT Injury Claim", "TPPD Claim"]) {
    await test(`${claimType} report prompt retains full MACT/TPPD structure (regression)`, async () => {
      const prompt = await generateReportPrompt(claimType, { doa: "15/03/2024", ivVehicle: "GJ-02-AX-1234" });
      assert(prompt.includes("Complete reconstruction from FIR, panchnama, DAR"), `${claimType} prompt must retain FIR/panchnama/DAR reconstruction instruction`);
      assert(prompt.includes("IV and TP vehicle details, RC, permit, fitness, DL, policy"), `${claimType} prompt must retain vehicle & document verification instruction`);
      assert(prompt.includes("DL validity/class mismatch"), `${claimType} prompt must retain DL validity redFlag rule`);
      assert(prompt.includes("Permit/fitness expiry"), `${claimType} prompt must retain permit/fitness redFlag rule`);
      assert(prompt.includes("Date of Accident: 15/03/2024"), `${claimType} case header must still include Date of Accident`);
      assert(prompt.includes("Insured Vehicle: GJ-02-AX-1234"), `${claimType} case header must still include Insured Vehicle`);
      assert(!prompt.includes("HEALTH CLAIM — ADDITIONAL FACT-HANDLING RULES"), `${claimType} prompt must not include the Health-Claim-only fact-handling block`);
    });
  }

  // ── 5. Clearly legible identity preserved exactly ──
  await test("5. Clearly legible extracted values pass through autoFillDocument unchanged", async () => {
    const { AIService } = loadAIService({
      fetchImpl: fakeCompletionResponse({ hospital: "Pt. B.D. Sharma PGIMS, Rohtak", admissionDate: "13/8/16", dischargeDate: "18/8/16", diagnosis: "", treatment: "", conditionAtDischarge: "", narrative: "", remarks: "" }),
    });
    const result = await AIService.autoFillDocument({ category: DISCHARGE_SUMMARY_CATEGORY, files: [] });
    assert(result.hospital === "Pt. B.D. Sharma PGIMS, Rohtak", "clearly legible hospital name must pass through unchanged");
    assert(result.admissionDate === "13/8/16" && result.dischargeDate === "18/8/16", "clearly legible dates must pass through unchanged");
  });

  // ── 6. Ambiguous handwriting produces uncertain/verification-required output ──
  await test("6. Extraction prompt instructs against normalizing ambiguous handwriting into a confident value", async () => {
    const { AIService, calls } = loadAIService({ fetchImpl: fakeCompletionResponse({}) });
    await AIService.autoFillDocument({ category: DISCHARGE_SUMMARY_CATEGORY, files: [] });
    const prompt = calls[0].body.prompt;
    assert(prompt.includes("Unclear / requires human verification"), "extraction prompt must define the uncertain-value convention");
    assert(/do not normalize illegible handwriting/i.test(prompt), "extraction prompt must instruct against normalizing illegible handwriting");
    assert(/medical diagnoses, proper names, and identification numbers/i.test(prompt), "extraction prompt must call out diagnoses/names/ID numbers specifically");
  });
  await test("6b. An 'Unclear / requires human verification' extraction response is preserved exactly, not silently replaced", async () => {
    const { AIService } = loadAIService({
      fetchImpl: fakeCompletionResponse({ hospital: "", admissionDate: "", dischargeDate: "", diagnosis: "Unclear / requires human verification", treatment: "", conditionAtDischarge: "", narrative: "", remarks: "" }),
    });
    const result = await AIService.autoFillDocument({ category: DISCHARGE_SUMMARY_CATEGORY, files: [] });
    assert(result.diagnosis === "Unclear / requires human verification", "uncertain-diagnosis marker must be preserved exactly");
  });

  // ── 7. "Dharam/Dharm Singh, 50, Male" is not transformed into "Dharamvati, Female" ──
  await test("7. Correct identity value is preserved unchanged through the extraction contract (DEMO0001 regression marker)", async () => {
    const { AIService } = loadAIService({ fetchImpl: fakeCompletionResponse({ name: "Dharam Singh", age: "50", sex: "Male" }) });
    const result = await AIService.autoFillDocument({ category: PARTICULARS_CATEGORY, files: [] });
    assert(result.name === "Dharam Singh" && result.age === "50" && result.sex === "Male", "correctly-extracted identity must pass through unchanged");
  });

  // ── 8. Conflicting identity produces a review discrepancy instead of silent selection ──
  await test("8. Health Claim report prompt instructs surfacing identity conflicts instead of silently picking one value", async () => {
    const prompt = await generateReportPrompt("Health Claim");
    assert(prompt.includes("do NOT silently choose the value that seems more complete or official"), "must instruct against silent identity resolution");
    assert(prompt.includes("requires human verification before the identity is treated as settled"), "must instruct surfacing identity conflicts for review");
  });

  // ── 9. Pharmacy documents are not silently ignored ──
  await test("9a. category.analysisHint (existing mechanism) reaches the extraction prompt verbatim", async () => {
    const { AIService, calls } = loadAIService({ fetchImpl: fakeCompletionResponse({}) });
    const category = { key: "medicalBills", title: "Medical Bills & Expenses", fields: [{ key: "billBreakdown", label: "Bill breakdown", area: true }], analysisHint: "TEST_HINT_MARKER_12345" };
    await AIService.autoFillDocument({ category, files: [] });
    assert(calls[0].body.prompt.includes("TEST_HINT_MARKER_12345"), "category.analysisHint must reach the extraction prompt");
  });
  await test("9b. report.html's medicalBills category defines a pharmacy/cash-memo analysisHint", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "report.html"), "utf8");
    const idx = html.indexOf('key:"medicalBills"');
    assert(idx !== -1, "medicalBills category not found in report.html");
    const nearby = html.slice(idx, idx + 2200);
    assert(/analysisHint/.test(nearby), "medicalBills category should define an analysisHint");
    assert(/pharmacy|cash memo|chemist/i.test(nearby), "medicalBills analysisHint should specifically address pharmacy/cash-memo documents");
  });

  // ── 10. Unclear medicine names remain uncertain ──
  await test("10. medicalBills analysisHint instructs the uncertain-value convention for illegible medicine names", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "report.html"), "utf8");
    const idx = html.indexOf('key:"medicalBills"');
    const nearby = html.slice(idx, idx + 2200);
    assert(/Unclear \/ requires human verification/.test(nearby), "medicalBills analysisHint should reference the uncertain-value convention");
    assert(/do not invent a medicine name/i.test(nearby), "medicalBills analysisHint should explicitly forbid inventing medicine names");
  });

  // ── 11. Medical timeline includes dated OPD/pharmacy events when supplied ──
  await test("11. Timeline Intelligence prompt's example events include OPD visit and pharmacy purchase, not just motor-accident examples", async () => {
    const { AIService, calls } = loadAIService({
      registryRows: [{ module_id: "timelineIntelligence", module_label: "Timeline Intelligence" }],
      fetchImpl: fakeCompletionResponse({ events: [], anomalies: [], confidence: "high" }),
    });
    await AIService.getLegalIntelligence({ docsText: "some case text" });
    const prompt = calls[0].body.prompt;
    assert(/OPD visit/i.test(prompt), "timeline prompt should mention OPD visit as an example event type");
    assert(/pharmacy/i.test(prompt), "timeline prompt should mention pharmacy purchase as an example event type");
  });

  // ── 12. Unsupported medical statements cannot be generated from absent source evidence ──
  await test("12. Health Claim prompt forbids fabricating missing information (fact-preservation rule D)", async () => {
    const prompt = await generateReportPrompt("Health Claim");
    assert(prompt.includes("never fabricate a plausible-sounding substitute"), "must forbid fabricating missing information");
  });

  // ── 13. OCR/AI uncertainty is not classified as fraud by itself ──
  await test("13. Health Claim redFlag rules forbid treating OCR/extraction uncertainty as a claimant/document red flag", async () => {
    const prompt = await generateReportPrompt("Health Claim");
    assert(prompt.includes("Never include an item here whose only basis is a document being hard to read"), "redFlag rules must forbid OCR-uncertainty-as-fraud");
    assert(prompt.includes("NOT, by itself, evidence of claimant fraud or document fabrication"), "observations guide must forbid treating illegibility as fraud evidence");
  });

  // ── Supplementary: multi-document safety (fix #10 in the request) ──
  await test("Supplementary: extraction prompt instructs against blending distinct document types into one invented narrative", async () => {
    const { AIService, calls } = loadAIService({ fetchImpl: fakeCompletionResponse({}) });
    await AIService.autoFillDocument({ category: DISCHARGE_SUMMARY_CATEGORY, files: [] });
    const prompt = calls[0].body.prompt;
    assert(/more than one distinct source document/i.test(prompt), "extraction prompt must warn against blending distinct document types");
    assert(/do not blend them into a single invented narrative/i.test(prompt), "extraction prompt must explicitly forbid inventing connective narrative across document types");
  });

  // ── Supplementary: header extraction now recognizes Health Claim ──
  await test("Supplementary: _buildHeaderAutoFillPrompt's claimType enum includes 'Health Claim'", async () => {
    const { AIService, calls } = loadAIService({ fetchImpl: fakeCompletionResponse({}) });
    await AIService.autoFillCaseHeader({ files: [] });
    assert(calls[0].body.prompt.includes("'Health Claim'"), "header auto-fill prompt must list 'Health Claim' as a valid claimType");
  });

  // ── Gap-close round: deterministic identity cross-check + multi-doc page count ──
  // These close the two gaps the prior audit found were prompt-only: the extraction
  // contract now carries _identitySignals/_pageCount as real data, and a caller-supplied,
  // pre-computed identityConflicts list is transcribed into the prompt as an already-
  // verified fact block, not left for the model to discover on its own.

  await test("Gap-close 1: extraction prompt requests _identitySignals as part of the JSON contract", async () => {
    const { AIService, calls } = loadAIService({ fetchImpl: fakeCompletionResponse({}) });
    await AIService.autoFillDocument({ category: DISCHARGE_SUMMARY_CATEGORY, files: [] });
    const prompt = calls[0].body.prompt;
    assert(prompt.includes("_identitySignals"), "extraction prompt must request _identitySignals");
    assert(prompt.includes('"uhid"') && prompt.includes('"caseNo"') && prompt.includes('"opdNo"'), "extraction prompt must request uhid/caseNo/opdNo sub-fields");
  });

  await test("Gap-close 2: autoFillDocument returns _identitySignals and _pageCount alongside normal fields, unmodified", async () => {
    const { AIService } = loadAIService({
      fetchImpl: fakeCompletionResponse({ hospital: "Test Hospital", admissionDate: "", dischargeDate: "", diagnosis: "", treatment: "", conditionAtDischarge: "", narrative: "", remarks: "", _identitySignals: { name: "Dharam Singh", age: "50", sex: "Male", uhid: "", caseNo: "", opdNo: "" } }),
    });
    const result = await AIService.autoFillDocument({ category: DISCHARGE_SUMMARY_CATEGORY, files: [] });
    assert(result.hospital === "Test Hospital", "normal fields must still be returned unchanged");
    assert(result._identitySignals && result._identitySignals.name === "Dharam Singh" && result._identitySignals.sex === "Male", "_identitySignals must be returned unmodified");
    assert(result._pageCount === 0, "_pageCount must reflect the actual number of images processed (0 for no files)");
  });

  await test("Gap-close 3: a caller-supplied identityConflicts list is transcribed into the Health Claim prompt as a code-verified fact block, with exact values", async () => {
    const conflicts = [{ field: "Patient name", values: [
      { value: "Dharamvati", sources: ["MLC & Medical / Injury Details"] },
      { value: "Dharam Singh", sources: ["Discharge Summary"] },
    ] }];
    const prompt = await generateReportPrompt("Health Claim", {}, conflicts);
    assert(prompt.includes("IDENTITY CONFLICTS DETECTED BY THE SYSTEM"), "prompt must include the code-verified conflicts block when conflicts are supplied");
    assert(prompt.includes('"Dharamvati" (per MLC & Medical / Injury Details)'), "prompt must cite the exact first conflicting value and its source");
    assert(prompt.includes('"Dharam Singh" (per Discharge Summary)'), "prompt must cite the exact second conflicting value and its source");
    assert(prompt.includes("must NOT silently resolve any of them to a single value"), "prompt must instruct against silent resolution of the pre-detected conflict");
  });

  await test("Gap-close 4: no identityConflicts supplied -> no conflicts block in the prompt (no false-positive noise)", async () => {
    const prompt = await generateReportPrompt("Health Claim", {}, []);
    assert(!prompt.includes("IDENTITY CONFLICTS DETECTED BY THE SYSTEM"), "prompt must not include the conflicts block when there are no conflicts");
  });

  await test("Gap-close 5 (regression): identityConflicts is ignored for non-Health-Claim types — MACT/TPPD prompt shape unaffected", async () => {
    const conflicts = [{ field: "Patient name", values: [{ value: "A", sources: ["X"] }, { value: "B", sources: ["Y"] }] }];
    const prompt = await generateReportPrompt("MACT Death Claim", { doa: "15/03/2024", ivVehicle: "GJ-02-AX-1234" }, conflicts);
    assert(!prompt.includes("IDENTITY CONFLICTS DETECTED BY THE SYSTEM"), "MACT prompt must not carry the Health-Claim-only conflicts block even if identityConflicts is supplied");
    assert(prompt.includes("Complete reconstruction from FIR, panchnama, DAR"), "MACT structure must remain fully intact");
  });

  // ── Second gap-close round: hospitalIdentifier signal + multi-signal upload guard ──
  // Closes the two remaining gaps: (1) hospitalIdentifier added to the identity
  // cross-check, symmetric with the existing 6 signals; (2) the upload-safety guard no
  // longer relies on page count alone — a low page count is not automatically "safe."

  await test("Gap-close 6: extraction prompt requests hospitalIdentifier as part of _identitySignals", async () => {
    const { AIService, calls } = loadAIService({ fetchImpl: fakeCompletionResponse({}) });
    await AIService.autoFillDocument({ category: DISCHARGE_SUMMARY_CATEGORY, files: [] });
    const prompt = calls[0].body.prompt;
    assert(prompt.includes('"hospitalIdentifier"'), "extraction prompt must request hospitalIdentifier");
  });

  await test("Gap-close 7: extraction prompt requests _documentCountEstimate, distinct from page count", async () => {
    const { AIService, calls } = loadAIService({ fetchImpl: fakeCompletionResponse({}) });
    await AIService.autoFillDocument({ category: DISCHARGE_SUMMARY_CATEGORY, files: [] });
    const prompt = calls[0].body.prompt;
    assert(prompt.includes("_documentCountEstimate"), "extraction prompt must request _documentCountEstimate");
    assert(/distinct source documents \(not pages\)/i.test(prompt), "prompt must clarify document count is distinct from page count");
  });

  await test("Gap-close 8: autoFillDocument passes _documentCountEstimate through unmodified, alongside existing metadata", async () => {
    const { AIService } = loadAIService({
      fetchImpl: fakeCompletionResponse({ hospital: "Test Hospital", admissionDate: "", dischargeDate: "", diagnosis: "", treatment: "", conditionAtDischarge: "", narrative: "", remarks: "", _identitySignals: {}, _documentCountEstimate: "3" }),
    });
    const result = await AIService.autoFillDocument({ category: DISCHARGE_SUMMARY_CATEGORY, files: [] });
    assert(result._documentCountEstimate === "3", "_documentCountEstimate must be returned unmodified");
    assert(result._pageCount === 0, "_pageCount must still be present alongside the new field");
  });

  summary();
}

run();
