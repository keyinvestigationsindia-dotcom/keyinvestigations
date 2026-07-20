// ============================================================
// Reusable Node `vm`-sandbox test harness for js/ai-service.js
// ============================================================
// ai-service.js is a plain browser script (top-level const/function, no
// module.exports, references window/document/fetch). This runs it in a
// sandboxed context with those globals mocked, so its logic (dispatch,
// parsing, formatting) can be tested deterministically — no live session,
// no real API cost, no network flakiness. Documented pattern:
// docs/legal-intelligence/testing-guide.md §1. First committed to the repo
// alongside the Investigation Decision Engine tests — v1.0-RELEASE-HANDOVER.md
// §7 flagged this exact gap ("test files live in session-scratch storage,
// not keyinvestigations/") as something to formalize before v1.1 added more
// modules; this closes it using the pattern already designed during v1.0,
// not a new invention, so future modules can reuse it directly.

const vm = require("vm");
const fs = require("fs");
const path = require("path");

const AI_SERVICE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "js", "ai-service.js"), "utf8");

// Builds a fresh sandboxed AIService for one test. Returns `calls`, a log of
// every fetch made (url + parsed JSON body) — this is what lets a test
// assert on the actual prompt text sent, e.g. the docsText-leak check,
// without a network mock library.
function loadAIService({ registryRows, fetchImpl } = {}) {
  const calls = [];
  const sandbox = {
    console, setTimeout, Promise, Date, JSON, Math,
    window: { location: { href: "" } },
    document: { createElement: () => ({}), head: { appendChild: () => {} } },
    crypto: { randomUUID: () => "test-uuid" },
  };
  sandbox.sb = {
    auth: { getSession: async () => ({ data: { session: { access_token: "fake-token" } } }) },
    from(table) {
      if (table !== "legal_intelligence_modules") throw new Error("unexpected table " + table);
      return {
        select() { return this; },
        eq() { return this; },
        order: async () => ({ data: registryRows || [], error: null }),
      };
    },
  };
  sandbox.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, body });
    return fetchImpl ? fetchImpl(url, opts) : {
      ok: true, status: 200,
      json: async () => ({ content: "{}", stop_reason: "end_turn" }),
      text: async () => "{}",
    };
  };
  vm.createContext(sandbox);
  vm.runInContext(AI_SERVICE_SOURCE, sandbox, { filename: "ai-service.js" });
  // Top-level `const` in vm-run code doesn't attach to the sandbox object
  // automatically — pull it out explicitly.
  sandbox.AIService = vm.runInContext("AIService", sandbox);
  return { AIService: sandbox.AIService, calls };
}

// Wraps a JS object as a fake /ki/completion success response.
function fakeCompletionResponse(contentObj, { stop_reason = "end_turn", status = 200 } = {}) {
  return async () => ({
    ok: status < 400,
    status,
    json: async () => ({ content: JSON.stringify(contentObj), stop_reason, model: "test-model" }),
    text: async () => JSON.stringify({ content: JSON.stringify(contentObj) }),
  });
}

// A backend-error fetch impl, for any endpoint/body.
function fakeErrorResponse(status = 500, body = "Internal Server Error") {
  return async () => ({
    ok: false,
    status,
    json: async () => { throw new Error("not json"); },
    text: async () => body,
  });
}

// Minimal PASS/FAIL runner matching this project's documented practice
// ("each file prints PASS/FAIL per case and exits non-zero on any failure",
// testing-guide.md §4) — no external framework, consistent with the
// project's own no-build-step, no-bundler constraint.
let _passed = 0;
let _failed = 0;
async function test(name, fn) {
  try {
    await fn();
    _passed++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    _failed++;
    console.log(`FAIL: ${name}`);
    console.log(`      ${e.message}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message || "assertion failed");
}
function summary() {
  console.log(`\n${_passed} passed, ${_failed} failed`);
  if (_failed > 0) process.exit(1);
}

module.exports = { loadAIService, fakeCompletionResponse, fakeErrorResponse, test, assert, summary };
