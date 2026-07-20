# Testing Guide — Legal & Investigation Intelligence (v1.0)

This project has no build step and no bundled test framework (consistent with the "pure static HTML/CSS/JS, no build step, no framework, no bundler" architecture). Testing for the Legal & Investigation Intelligence Engine uses two custom, dependency-light harnesses, both proven across 49 passing tests during v1.0 development.

## 1. Logic-level testing — Node `vm` sandbox

Tests `js/ai-service.js` directly, with the Supabase client and `fetch` mocked, so every module's dispatch/parsing/formatting logic is exercised deterministically — no live session, no real API cost, no network flakiness.

### Why `vm`, not just `require`

`ai-service.js` is a plain browser script (top-level `const`/`function`, no `module.exports`, references browser globals like `window`/`document`/`fetch`). Node's `vm` module runs it in a sandboxed context where those globals are provided as mocks:

```js
const vm = require("vm");
const sandbox = {
  console, setTimeout, Promise, Date, JSON, Math,
  window: { location: { href: "" } },
  document: { createElement: () => ({}), head: { appendChild: () => {} } },
  crypto: { randomUUID: () => "test-uuid" },
  sb: { /* mocked Supabase client, see below */ },
  fetch: fetchImpl, // mocked, see below
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "ai-service.js" });
// Top-level `const` in vm-run code doesn't attach to the sandbox object automatically:
sandbox.AIService = vm.runInContext("AIService", sandbox);
```

### Mocking the registry (`sb`)

```js
sb: {
  auth: { getSession: async () => ({ data: { session: { access_token: "fake-token" } } }) },
  from(table) {
    if (table !== "legal_intelligence_modules") throw new Error("unexpected table " + table);
    return {
      select() { return this; }, eq() { return this; },
      order: async () => ({ data: registryRows, error: null }), // or { data: null, error: {...} } to simulate failure
    };
  },
}
```

**Always scope `registryRows` to only the module(s) under test**, plus one or two permanently-external control rows (e.g. `courtCaseIntelligence`, which will never gain an implementation). Using the full 12-row registry in every test makes tests stale every time a new module ships — this happened twice during v1.0 development and required fixing. A module's own test file should never assert on the global state of "how many modules are implemented today."

### Mocking the AI backend (`fetch`)

```js
function fakeCompletionResponse(contentObj, { stop_reason = "end_turn", status = 200 } = {}) {
  return async () => ({
    ok: status < 400, status,
    json: async () => ({ content: JSON.stringify(contentObj), stop_reason, model: "test-model" }),
    text: async () => JSON.stringify({ content: JSON.stringify(contentObj) }),
  });
}
```
Construct the exact JSON a module's prompt asks for (e.g. `{ events: [...], anomalies: [...], confidence: "high" }` for Timeline Intelligence) to test the happy path; construct malformed/wrong-typed/error responses to test robustness (below).

### Required test cases per module

1. **Normal case** — plausible input, confirm `status`, `summary`, `details`, `references` all correct.
2. **Flagged/discrepancy case** — confirm severity/priority labels and detail text surface correctly.
3. **Zero-data empty state** — confirm the module's specific empty message (not a generic "0 items"), and that `references`/`evidence` are empty arrays, not `null` or missing.
4. **Malformed JSON** (`"not valid json {{{"`) — confirm the module degrades to `status: "Not Performed"`, does not throw past the dispatch boundary.
5. **Wrong-type JSON** (valid JSON, but an array field is a string/object/null) — confirm the `Array.isArray` guards recover gracefully rather than crashing.
6. **Backend error** (`ok: false, status: 500`) — confirm placeholder fallback.
7. **Independence** — at least one test with multiple real modules in the registry simultaneously, one deliberately failing, confirming the others are unaffected and the total module count is unchanged.

## 2. Rendering-level testing — real React component harness

Tests `ModuleCard`/`LegalIntelligenceSection` **using the actual source**, copied verbatim from `report.html` into a standalone HTML file, run via the Browser preview tooling (no login required — these components don't depend on auth).

### Harness shape

```html
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script type="text/plain" id="jsx-source">
  // Icon subset, formatDateDMY, LEGAL_STATUS_STYLE, ModuleCard, LegalIntelligenceSection —
  // copied verbatim from report.html. Plus a mountScenario(data) helper exposed on window.
</script>
<script>
  var result = Babel.transform(document.getElementById('jsx-source').textContent, {...});
  new Function(result.code)();
</script>
```

**Copy the component source verbatim, do not paraphrase it** — the point is testing the real render logic, not a reimplementation that could silently drift from what's actually deployed.

### Key gotcha: React 18 async rendering

`ReactDOM.createRoot(root).render(el)` does not update the DOM synchronously. Reading `root.innerHTML` immediately after `.render()` returns an empty/stale result. Use `ReactDOM.flushSync(() => r.render(el))` for synchronous test assertions, or `await new Promise(r => setTimeout(r, 30))` after a simulated click before reading post-interaction DOM state (state updates from event handlers are also batched/async).

### Required scenarios

- `null`/`undefined` data (draft predates the column, or has never been refreshed).
- Old envelope shape (no `schemaVersion`/`generatedAt`) — backward compatibility.
- A record missing optional fields entirely.
- Full production shape (12 modules, mixed statuses).
- **Malformed `modules`** (not an array — string/object/number) — this exact scenario caught a real crash-the-whole-app bug during v1.0 development (see [Architecture §6](architecture.md#6-design-principles-binding-for-all-future-modules)) before it reached a live investigator. Always include it for any renderer change.
- Click-to-expand interaction (`ModuleCard`'s collapse/expand).
- Refresh button → `onRefresh` callback fires exactly once.

### XSS check

Every rendering test pass should include at least one record with `summary`/`details` containing `<script>`/`<img onerror=...>` and confirm (a) no such tag appears in the live DOM (`querySelectorAll('script').length === 0`), and (b) the injected handler never fires. React's default JSX escaping makes this safe by construction — the test exists to catch a regression (e.g., an accidental future `dangerouslySetInnerHTML`), not because it's expected to fail.

## 3. Export-function testing

`legalIntelligenceRowsHtml`/`legalIntelligenceTextLines` are pure string-building functions (only dependency: `escapeHtml`, `formatDateDMY`) — copy them verbatim into a plain Node script, no `vm`/browser needed. Required cases: status-gated detail (only `Completed`/`Pending Verification` show `summary`/`details`; `Not Performed`/`Not Applicable` show status only), XSS-escaping (same as above, but asserting `&lt;script&gt;` appears where `<script>` was fed in), and the same malformed-`modules` guard as the renderer.

## 4. Running the suite

Test files live outside the repo (session scratchpad during development) — there is no `npm test` or CI runner configured for this static-site project. To exercise the full suite: run each `test-*.js` file with plain `node <file>.js`; each prints `PASS`/`FAIL` per case and exits non-zero on any failure. Re-running the full set after any `ai-service.js` change, before committing, is the standing practice for this project — see the commit history for the exact test files used per module (referenced in each module's commit message).

## 5. Regression-scope verification (non-test, but standing practice)

Before every commit: `git diff --stat report.html` should be empty for any change that's purely a new document-based module. If it isn't, the change touched the renderer/exports/persistence layer, which should not be necessary for a routine module addition — treat this as a signal to re-check the change, not just a note.
