import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { analyseGrammar, validateGrammarResponse } from "./grammar.js";

const originalText = "我有两个书。";

// Unit tests never use local credentials or make external requests.
beforeEach((t) => {
  const previousEnvironment = process.env;
  process.env = { ...process.env, GEMINI_API_KEY: "", GEMINI_MODEL: "" };
  t.after(() => { process.env = previousEnvironment; });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request in unit test.");
  });
});

function mockGemini(t, handler) {
  process.env.GEMINI_API_KEY = "unit-test-key";
  return t.mock.method(globalThis, "fetch", handler);
}

function geminiResponse(text) {
  return Response.json({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
  });
}

function correction() {
  return {
    correctedText: "我有两本书。",
    issues: [
      {
        id: "issue-1",
        type: "word_choice",
        original: "个",
        replacement: "本",
        explanation: "Use 本 as the measure word for books.",
      },
    ],
  };
}

test("valid corrections retain all contract fields without mutating the response", () => {
  const response = correction();
  const expected = structuredClone(response);
  const result = validateGrammarResponse(response, originalText);
  assert.deepEqual(result, expected);
  assert.deepEqual(response, expected);
  assert.notEqual(result, response);
  assert.notEqual(result.issues[0], response.issues[0]);
});

test("no issues returns the exact original input, even if the provider rewrote it", () => {
  for (const text of ["我是学生。", "  我是学生。\n"]) {
    assert.deepEqual(
      validateGrammarResponse({ correctedText: "我是一名学生。", issues: [] }, text),
      { correctedText: text, issues: [] },
    );
  }
});

test("all three issue types and insertion/deletion strings are supported", () => {
  for (const type of ["grammar", "word_choice", "character"]) {
    const response = correction();
    response.issues[0].type = type;
    response.issues[0].replacement = "";
    assert.deepEqual(validateGrammarResponse(response, originalText), response);
    response.issues[0].original = "";
    response.issues[0].replacement = "本";
    assert.deepEqual(validateGrammarResponse(response, originalText), response);
  }
});

test("normalisation omits provider-specific fields", () => {
  const response = correction();
  response.provider = "extra metadata";
  response.issues[0].confidence = 0.9;
  assert.deepEqual(validateGrammarResponse(response, originalText), correction());
});

test("malformed response containers are rejected with meaningful errors", () => {
  for (const response of [null, undefined, [], "{}", 1, new Date()]) {
    assert.throws(() => validateGrammarResponse(response, originalText), /expected an object/);
  }
  for (const issues of [undefined, null, {}, "issues"]) {
    assert.throws(
      () => validateGrammarResponse({ correctedText: "我是学生。", issues }, originalText),
      /issues must be an array/,
    );
  }
  for (const correctedText of [undefined, null, 42, "", "  "]) {
    assert.throws(
      () => validateGrammarResponse({ correctedText, issues: [] }, originalText),
      /correctedText must be a non-empty string/,
    );
  }
});

test("malformed issues identify the invalid field", () => {
  for (const issue of [null, [], "issue", undefined]) {
    assert.throws(
      () => validateGrammarResponse({ ...correction(), issues: [issue] }, originalText),
      /issues\[0\] must be an object/,
    );
  }
  for (const [field, values] of Object.entries({
    id: [undefined, 1, "", "  "],
    type: [undefined, 1, "style", "Grammar"],
    original: [undefined, null, 1],
    replacement: [undefined, null, 1],
    explanation: [undefined, null, 1, "", "  "],
  })) {
    for (const value of values) {
      const response = correction();
      response.issues[0][field] = value;
      assert.throws(
        () => validateGrammarResponse(response, originalText),
        new RegExp(`issues\\[0\\]\\.${field} must be`),
      );
    }
  }
});

test("duplicate issue IDs and sparse issue arrays are rejected", () => {
  const response = correction();
  response.issues.push({ ...response.issues[0] });
  assert.throws(() => validateGrammarResponse(response, originalText), /id must be unique/);
  response.issues = Array(1);
  assert.throws(() => validateGrammarResponse(response, originalText), /must be an object/);
});

test("empty and non-string inputs fail before provider configuration is checked", async () => {
  for (const text of [undefined, null, "", " \n\t", 42, {}, [], new String("我是学生。")]) {
    await assert.rejects(analyseGrammar(text), /text must be a non-empty string/);
    assert.throws(
      () => validateGrammarResponse(correction(), text),
      /text must be a non-empty string/,
    );
  }
});

test("invalid options and learner levels fail before provider configuration", async () => {
  for (const options of [null, [], "beginner", 1, true, new Date()]) {
    await assert.rejects(analyseGrammar(originalText, options), /options must be an object/);
  }
  for (const level of [null, "", "  ", 1, [], {}]) {
    await assert.rejects(
      analyseGrammar(originalText, { level }),
      /options.level must be a non-empty string/,
    );
  }
});

test("valid inputs explicitly reject until the provider is configured", async () => {
  for (const options of [undefined, {}, { level: undefined }, { level: "beginner" }, { level: "advanced" }]) {
    await assert.rejects(
      analyseGrammar(originalText, options),
      /Grammar LLM provider is not configured yet/,
    );
  }
});

test("Gemini request uses configured model, learner level and the complete response schema", async (t) => {
  process.env.GEMINI_MODEL = "configured-model";
  let body;
  const request = mockGemini(t, async (url, init) => {
    assert.match(String(url), /models\/configured-model:generateContent/);
    body = JSON.parse(init.body);
    return geminiResponse(JSON.stringify(correction()));
  });
  assert.deepEqual(await analyseGrammar(originalText, { level: "advanced" }), correction());
  assert.equal(request.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), { text: originalText, level: "advanced" });
  assert.match(body.systemInstruction.parts[0].text, /careful Chinese language tutor/);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  const schema = body.generationConfig.responseJsonSchema;
  assert.deepEqual(schema.required, ["correctedText", "issues"]);
  assert.deepEqual(schema.properties.issues.items.required, ["id", "type", "original", "replacement", "explanation"]);
  assert.deepEqual(schema.properties.issues.items.properties.type.enum, ["grammar", "word_choice", "character"]);
});

test("default model and learner level are used; issue-free output preserves input", async (t) => {
  process.env.GEMINI_MODEL = "  ";
  const text = "  我是学生。\n";
  mockGemini(t, async (url, init) => {
    assert.match(String(url), /models\/gemini-2\.5-flash:generateContent/);
    const body = JSON.parse(init.body);
    assert.equal(JSON.parse(body.contents[0].parts[0].text).level, "beginner");
    return geminiResponse(JSON.stringify({ correctedText: "我是一名学生。", issues: [] }));
  });
  assert.deepEqual(await analyseGrammar(text), { correctedText: text, issues: [] });
});

test("empty Gemini responses are rejected", async (t) => {
  for (const text of ["", " \n"]) {
    mockGemini(t, async () => geminiResponse(text));
    await assert.rejects(analyseGrammar(originalText), /empty grammar response/);
  }
  mockGemini(t, async () => Response.json({ candidates: [] }));
  await assert.rejects(analyseGrammar(originalText), /empty grammar response/);
});

test("malformed Gemini JSON is rejected without echoing response contents", async (t) => {
  mockGemini(t, async () => geminiResponse("private-provider-content {"));
  await assert.rejects(analyseGrammar(originalText), {
    message: "Gemini returned malformed JSON for grammar analysis.",
  });
});

test("Gemini results pass through the existing response validator", async (t) => {
  const response = correction();
  response.issues[0].type = "style";
  mockGemini(t, async () => geminiResponse(JSON.stringify(response)));
  await assert.rejects(analyseGrammar(originalText), /Invalid grammar response: issues\[0\].type/);
});

test("provider status errors are safe and never retried", async (t) => {
  for (const [status, message] of [
    [429, /rate limit or quota exceeded \(HTTP 429\)/],
    [404, /model is unavailable.*HTTP 404/],
    [401, /authentication or access denied \(HTTP 401\)/],
    [403, /authentication or access denied \(HTTP 403\)/],
    [400, /request failed \(HTTP 400\)/],
    [503, /request failed \(HTTP 503\)/],
  ]) {
    const request = mockGemini(t, async () => Response.json({
      error: { code: status, message: "private-provider-content unit-test-key" },
    }, { status }));
    await assert.rejects(analyseGrammar(originalText), (error) => {
      assert.match(error.message, message);
      assert.doesNotMatch(error.message, /private-provider-content|unit-test-key/);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(request.mock.callCount(), 1);
  }
});

test("network failures expose only a safe message", async (t) => {
  const request = mockGemini(t, async () => {
    throw new Error("unit-test-key private network details");
  });
  await assert.rejects(analyseGrammar(originalText), (error) => {
    assert.match(error.message, /request failed.*network access and request timeout/);
    assert.doesNotMatch(error.message, /unit-test-key|private/);
    return true;
  });
  assert.equal(request.mock.callCount(), 1);
});

test("whitespace-only credentials are treated as unconfigured", async () => {
  process.env.GEMINI_API_KEY = "   ";
  await assert.rejects(analyseGrammar(originalText), /not configured yet/);
});

test("importing the live script makes no request and prints nothing", async (t) => {
  const request = mockGemini(t, async () => { throw new Error("Must not be called"); });
  const log = t.mock.method(console, "log", () => {});
  const error = t.mock.method(console, "error", () => {});
  await import("../../scripts/test-grammar-live.mjs");
  assert.equal(request.mock.callCount(), 0);
  assert.equal(log.mock.callCount(), 0);
  assert.equal(error.mock.callCount(), 0);
});
