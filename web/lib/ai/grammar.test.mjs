import assert from "node:assert/strict";
import test from "node:test";
import { analyseGrammar, validateGrammarResponse } from "./grammar.js";

const originalText = "我有两个书。";

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
