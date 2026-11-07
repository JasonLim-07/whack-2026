// From web/: node --env-file=.env.local scripts/test-grammar-live.mjs "我有两个书。"
// One request per invocation; importing this module does not run a request.
import { pathToFileURL } from "node:url";
import { analyseGrammar } from "../lib/ai/grammar.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const text = process.argv[2] ?? "我有两个书。";
    const level = process.argv[3] ?? "beginner";
    const result = await analyseGrammar(text, { level });
    console.log(JSON.stringify({
      model: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
      input: text,
      result,
    }, null, 2));
  } catch (error) {
    // analyseGrammar exposes safe messages, never the raw SDK error or key.
    console.error(error.message);
    process.exitCode = 1;
  }
}
