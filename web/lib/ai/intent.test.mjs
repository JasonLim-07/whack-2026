import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { suggestIntent, validateIntentSuggestions } from "./intent.js";
import { POST } from "../../app/api/intent/route.js";
import { handleReview } from "./review.js";
import { getConfirmedText, requestConfirmedReview, requestIntentSuggestions } from "../review/client.mjs";

beforeEach((t) => {
  const previous = process.env;
  process.env = { ...previous, GEMINI_API_KEY: "unit-test-key", GOOGLE_API_KEY: "", GEMINI_MODEL: "test-model" };
  t.after(() => { process.env = previous; });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network call"); });
});
const choices = { suggestions: [{ text: "书", explanation: "A book." }, { text: "树", explanation: "A tree." }] };
const response = (text) => Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });
const request = (input) => new Request("http://localhost/api/intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });

test("intent schema accepts short Chinese possibilities and rejects malformed or Latin suggestions", () => {
  assert.deepEqual(validateIntentSuggestions(choices), choices);
  assert.deepEqual(validateIntentSuggestions({ ...choices, extra: true }).suggestions, choices.suggestions);
  for (const value of [null, {}, { suggestions: [] }, { suggestions: Array(4).fill(choices.suggestions[0]) },
    { suggestions: [{ text: "book", explanation: "A book" }] }, { suggestions: [{ text: "书", explanation: 4 }] },
    { suggestions: [choices.suggestions[0], choices.suggestions[0]] }]) {
    assert.throws(() => validateIntentSuggestions(value), /unexpected response/);
  }
});

test("real intent route uses Gemini structured output, sentence context and the configured model", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls++;
    assert.match(String(url), /test-model:generateContent/);
    const body = JSON.parse(init.body);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), { description: "something pronounced shu", context: "我有三[unclear]。" });
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.responseJsonSchema.properties.suggestions.maxItems, 3);
    assert.match(JSON.stringify(body.systemInstruction), /ambiguous.*2 or 3/);
    return response(JSON.stringify(choices));
  });
  const result = await POST(request({ description: "something pronounced shu", context: "我有三[unclear]。", revision: 7 }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ...choices, revision: 7 });
  assert.equal(calls, 1);
});

test("invalid intent requests are rejected without provider calls", async (t) => {
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not call"); });
  for (const input of [null, {}, { description: "", revision: 1 }, { description: "x", revision: -1 },
    { description: "x".repeat(301), revision: 1 }, { description: "x", context: 1, revision: 1 }]) {
    assert.equal((await POST(request(input))).status, 400);
  }
  assert.equal((await POST(new Request("http://localhost/api/intent", { method: "POST", body: "description" }))).status, 400);
  assert.equal((await POST(request({ description: "x".repeat(9000), revision: 1 }))).status, 413);
  assert.equal(network.mock.callCount(), 0);
});

test("missing configuration, malformed JSON and invalid suggestions fail safely", async (t) => {
  process.env.GEMINI_API_KEY = "";
  await assert.rejects(suggestIntent("a book"), /not configured/);
  process.env.GEMINI_API_KEY = "unit-test-key";
  for (const text of ["private malformed contents", "{}", JSON.stringify({ suggestions: [{ text: "Hello", explanation: "Bad" }] })]) {
    t.mock.method(globalThis, "fetch", async () => response(text));
    const result = await POST(request({ description: "a book", revision: 1 }));
    assert.equal(result.status, 502);
    assert.doesNotMatch(JSON.stringify(await result.json()), /private|unit-test-key|stack/);
  }
});

test("intent rate limits and provider failures are sanitized and never retried", async (t) => {
  for (const status of [429, 500]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: { message: "secret internal provider detail" } }, { status }); });
    const result = await POST(request({ description: "a book", revision: 1 }));
    assert.equal(result.status, status === 429 ? 429 : 502);
    assert.doesNotMatch(JSON.stringify(await result.json()), /secret|internal|detail/);
    assert.equal(calls, 1);
  }
});

test("English intent to explicit Chinese selection to JSON grammar review preserves the student mistake", async (t) => {
  t.mock.method(globalThis, "fetch", async () => response(JSON.stringify(choices)));
  const result = await requestIntentSuggestions("a book", "我有三[unclear]。", 7, undefined,
    async (_, init) => POST(new Request("http://localhost/api/intent", init)));
  const pending = { recognizedText: "我有三。", requiresVerification: true, status: "LOW_CONFIDENCE",
    ocrConfidence: null, ocrSegments: [], characterCandidates: [], revision: 7,
    intentTargets: [{ id: "missing", start: 3, end: 3, original: "" }] };
  assert.throws(() => getConfirmedText(pending, {}, undefined, { missing: result.suggestions }), /Choose/);
  const text = getConfirmedText(pending, { missing: "书" }, undefined, { missing: result.suggestions });
  assert.equal(text, "我有三书。");
  const review = await requestConfirmedReview(text, 7, undefined, async (_, init) => handleReview(new Request("http://localhost/api/review", init), {
    recogniseHandwriting: async () => { throw new Error("OCR must not run"); },
    analyseGrammar: async (input) => {
      assert.equal(input, "我有三书。");
      return { correctedText: "我有三本书。", issues: [{ id: "one", type: "grammar", original: "三书", replacement: "三本书", explanation: "Use 本 for books." }] };
    },
  }));
  assert.equal(review.correctedText, "我有三本书。");
});
