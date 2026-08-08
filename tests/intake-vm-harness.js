// ============================================================
// Reusable Node `vm`-sandbox test harness for js/intake-service.js
// ============================================================
// Sibling to vm-harness.js (js/ai-service.js's harness) — deliberately a
// separate file rather than a shared/parameterized one, so vm-harness.js
// and test-investigation-decision-engine.js stay at zero diff while this
// phase is verified (see phase-1-implementation-plan.md §2/§3's reasoning
// for keeping js/ai-service.js and its existing test untouched).
//
// Mocks: sb (Supabase — an in-memory fake intake_review_sessions table +
// storage bucket), fetch (AI Engine calls, logged), window.pdfjsLib (a
// fake N-page PDF so _renderAllPages can run without a real PDF file or
// a real pdf.js download), document.createElement("canvas") (a no-op 2D
// context whose toDataURL returns a deterministic fake image).

const vm = require("vm");
const fs = require("fs");
const path = require("path");

const INTAKE_SERVICE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "js", "intake-service.js"), "utf8");

function makeFakePdf(pageCount) {
  return {
    numPages: pageCount,
    getPage: async (n) => ({
      getViewport: () => ({ width: 100, height: 140 }),
      render: () => ({ promise: Promise.resolve() }),
    }),
  };
}

// In-memory fake for the one table this phase uses. Supports exactly the
// query shapes intake-service.js actually issues — not a general Supabase
// mock, a targeted one.
function makeFakeSupabaseTable(initialRows = []) {
  let rows = [...initialRows];
  let nextId = 1;
  return {
    _rows: () => rows,
    insert(record) {
      const row = { id: `sess_${nextId++}`, created_at: new Date().toISOString(), ...record };
      rows.push(row);
      return {
        select() { return this; },
        single: async () => ({ data: row, error: null }),
      };
    },
    update(patch) {
      let targetId = null;
      const builder = {
        eq(col, val) { if (col === "id") targetId = val; return builder; },
        select() { return builder; },
        single: async () => {
          const idx = rows.findIndex((r) => r.id === targetId);
          if (idx === -1) return { data: null, error: { message: "not found" } };
          rows[idx] = { ...rows[idx], ...patch };
          return { data: rows[idx], error: null };
        },
      };
      return builder;
    },
    select() {
      let filters = [];
      const builder = {
        eq(col, val) { filters.push([col, val]); return builder; },
        order() { return builder; },
        single: async () => {
          const found = rows.find((r) => filters.every(([c, v]) => r[c] === v));
          return found ? { data: found, error: null } : { data: null, error: { message: "not found" } };
        },
        // listIntakeSessionsForDraft's await-chain resolves the builder
        // itself when not terminated by .single()
        then(resolve) {
          const found = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
          resolve({ data: found, error: null });
        },
      };
      return builder;
    },
  };
}

function makeFakeStorage() {
  const objects = new Map();
  return {
    from(bucket) {
      return {
        upload: async (path, blob) => { objects.set(bucket + "/" + path, blob); return { data: { path }, error: null }; },
        download: async (path) => {
          const blob = objects.get(bucket + "/" + path);
          return blob ? { data: blob, error: null } : { data: null, error: { message: "not found" } };
        },
        createSignedUrl: async (path) => ({ data: { signedUrl: `https://fake-signed-url.test/${bucket}/${path}` }, error: null }),
      };
    },
  };
}

// Builds a fresh sandboxed IntakeService for one test.
function loadIntakeService({ fetchImpl, pageCount = 1, tableRows = [] } = {}) {
  const calls = [];
  const table = makeFakeSupabaseTable(tableRows);
  const storage = makeFakeStorage();
  const sandbox = {
    console, setTimeout, Promise, Date, JSON, Math, atob, Blob, File,
    window: { location: { href: "" }, pdfjsLib: { getDocument: () => ({ promise: Promise.resolve(makeFakePdf(pageCount)) }), GlobalWorkerOptions: {} } },
    document: {
      createElement: (tag) => {
        if (tag === "canvas") {
          return {
            width: 0, height: 0,
            getContext: () => ({ fillStyle: "", fillRect() {} }),
            toDataURL: () => "data:image/jpeg;base64,ZmFrZS1wYWdlLWltYWdl",
          };
        }
        return { onload: null, onerror: null };
      },
      head: { appendChild: () => {} },
    },
  };
  sandbox.sb = {
    auth: { getSession: async () => ({ data: { session: { access_token: "fake-token" } } }) },
    from(name) {
      if (name !== "intake_review_sessions") throw new Error("unexpected table " + name);
      return table;
    },
    storage,
  };
  sandbox.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, body });
    return fetchImpl ? fetchImpl(url, opts, calls.length) : {
      ok: true, status: 200,
      json: async () => ({ content: JSON.stringify({ pages: [] }), stop_reason: "end_turn" }),
      text: async () => "{}",
    };
  };
  vm.createContext(sandbox);
  vm.runInContext(INTAKE_SERVICE_SOURCE, sandbox, { filename: "intake-service.js" });
  sandbox.IntakeService = vm.runInContext("IntakeService", sandbox);
  return { IntakeService: sandbox.IntakeService, calls, tableRows: table._rows() };
}

function fakeVisionResponse(contentObj, { status = 200 } = {}) {
  return async () => ({
    ok: status < 400, status,
    json: async () => ({ content: JSON.stringify(contentObj), stop_reason: "end_turn" }),
    text: async () => JSON.stringify(contentObj),
  });
}
function fakeErrorResponse(status = 500, body = "Internal Server Error") {
  return async () => ({ ok: false, status, json: async () => { throw new Error("not json"); }, text: async () => body });
}

// Fake File — good enough for tests that only need file.arrayBuffer()
// (the real _renderAllPages call site); pdf.js itself is fully mocked so
// the buffer's actual content is never inspected.
function fakePdfFile() {
  return { arrayBuffer: async () => new ArrayBuffer(8) };
}

let _passed = 0, _failed = 0;
async function test(name, fn) {
  try { await fn(); _passed++; console.log(`PASS: ${name}`); }
  catch (e) { _failed++; console.log(`FAIL: ${name}`); console.log(`      ${e.stack || e.message}`); }
}
function assert(cond, message) { if (!cond) throw new Error(message || "assertion failed"); }
function assertArrayEqual(a, b, message) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${message || "arrays differ"}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}
function summary() { console.log(`\n${_passed} passed, ${_failed} failed`); if (_failed > 0) process.exit(1); }

module.exports = { loadIntakeService, fakeVisionResponse, fakeErrorResponse, fakePdfFile, test, assert, assertArrayEqual, summary };
