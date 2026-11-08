import { handleGrammar } from "../../../lib/ai/review.js";
import { analyseGrammar } from "../../../lib/ai/grammar.js";

export const runtime = "nodejs";
export function POST(request) {
  return handleGrammar(request, { analyseGrammar: async (text, options) => {
    try { return await analyseGrammar(text, { ...options, signal: request.signal }); }
    catch (error) {
      // These prefixes are produced by our grammar validator/provider adapter.
      // Never log arbitrary SDK exceptions, request text, credentials or causes.
      const message = typeof error.message === "string" && /^(Gemini |Configured Gemini |Invalid grammar response:|Grammar LLM provider)/u.test(error.message)
        ? error.message : "Grammar checking failed.";
      console.warn("Grammar checker:", message);
      throw error;
    }
  } });
}
