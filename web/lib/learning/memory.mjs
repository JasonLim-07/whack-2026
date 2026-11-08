import { GRAMMAR_CATEGORIES, WORD_ORDER_SUBCATEGORIES, validIssueCategory } from "./categories.mjs";
import { validTextRange } from "../review/locations.mjs";

const STORAGE_KEY = "inkling.learning.v1";
const countsFor = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
const empty = () => ({ version: 1, categories: countsFor(GRAMMAR_CATEGORIES),
  wordOrderSubcategories: countsFor(WORD_ORDER_SUBCATEGORIES), attempts: [] });
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
const validSession = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

function validState(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.attempts)) return false;
  for (const [name, keys] of [["categories", GRAMMAR_CATEGORIES], ["wordOrderSubcategories", WORD_ORDER_SUBCATEGORIES]]) {
    if (!value[name] || Object.keys(value[name]).length !== keys.length || !keys.every((key) => validCount(value[name][key]))) return false;
  }
  const sessions = new Set();
  return value.attempts.every((attempt) => {
    if (!attempt || !validSession(attempt.sessionId) || !validCount(attempt.revision) || sessions.has(attempt.sessionId)) return false;
    sessions.add(attempt.sessionId);
    return true;
  });
}

function browserStorage() {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

function completed(review) {
  return review && !review.error && review.requiresVerification !== true && review.requiresTextConfirmation !== true &&
    !["LOW_CONFIDENCE", "UNREADABLE"].includes(review.status) && !review.unresolvedRegions?.length &&
    typeof review.recognizedText === "string" && !!review.recognizedText.trim() &&
    typeof review.correctedText === "string" && !!review.correctedText.trim() && Array.isArray(review.issues);
}

function grammarIssues(review) {
  if (!completed(review) || review.correctedText === review.recognizedText) return [];
  return review.issues.filter((issue) => issue && ["grammar", "word_choice"].includes(issue.type) &&
    GRAMMAR_CATEGORIES.includes(issue.category) && validIssueCategory(issue) && issue.visuallyUncertain !== true &&
    typeof issue.original === "string" && typeof issue.replacement === "string" && issue.original !== issue.replacement &&
    validTextRange(review.recognizedText, issue.start, issue.end, issue.original));
}

const tips = {
  measure_word: "Measure words have come up again. Use number + measure word + noun: 三本书 means three books.",
  word_order: "Word order has come up again. Notice how 我明天在学校学习 puts time and place before the action.",
  particle: "Particles have come up again. Check their job: 的 links a description to a noun; 吗 marks a yes/no question.",
  missing_word: "An omitted word has come up again. Read the corrected phrase aloud, then use its complete structure in a new sentence.",
  verb_usage: "Verb usage has come up again. Check what follows the verb: 我喜欢看书 uses 喜欢 followed by an action.",
  other: "Grammar errors have appeared in more than one attempt. Reuse the highlighted corrected phrase in a new sentence.",
};
const orderTips = {
  time_placement: "Time placement has come up again. Time expressions usually go before the action: 我明天去学校。",
  location_placement: "Place expressions have come up again. For where an action happens, try 在 + place before the verb: 我在学校学习。",
  question_word_placement: "Question-word placement has come up again. Put the question word where its answer would go: 你买什么？",
};

/** See README.md. One instance per workspace; no timers, images or text storage. */
export function createLearnerMemory(storage = browserStorage()) {
  let state = empty();
  let persistent = storage !== null;
  function read() {
    if (persistent) {
      try {
        const raw = storage.getItem(STORAGE_KEY);
        const value = raw === null ? null : JSON.parse(raw);
        // Ignore unknown/invalid state and strip unrelated stored properties.
        state = validState(value) ? { version: 1, categories: { ...value.categories },
          wordOrderSubcategories: { ...value.wordOrderSubcategories },
          attempts: value.attempts.map(({ sessionId, revision }) => ({ sessionId, revision })) } : empty();
      } catch { persistent = false; }
    }
    return state;
  }
  function write() {
    if (persistent) {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); }
      catch { persistent = false; } // Keep working in memory if storage is blocked/full.
    }
  }
  return {
    /** Call only for a current, successful review; revision is the drawing revision. */
    recordCompletedReview(review, { sessionId, revision } = {}) {
      if (!completed(review) || !validSession(sessionId) || !validCount(revision) || review.revision !== revision) return false;
      read();
      const attempt = state.attempts.find((entry) => entry.sessionId === sessionId);
      if (attempt && revision <= attempt.revision) return false;
      if (attempt) attempt.revision = revision;
      else state.attempts.push({ sessionId, revision });
      const issues = grammarIssues(review);
      for (const category of new Set(issues.map((issue) => issue.category))) {
        state.categories[category] = Math.min(Number.MAX_SAFE_INTEGER, state.categories[category] + 1);
      }
      for (const subcategory of new Set(issues.filter((issue) => issue.category === "word_order" && issue.subcategory).map((issue) => issue.subcategory))) {
        state.wordOrderSubcategories[subcategory] = Math.min(Number.MAX_SAFE_INTEGER, state.wordOrderSubcategories[subcategory] + 1);
      }
      write();
      return true;
    },
    getDifficultyCategories() {
      const value = read();
      return { categories: { ...value.categories }, wordOrderSubcategories: { ...value.wordOrderSubcategories } };
    },
    getPersonalisedTip(review) {
      const value = read();
      const issue = grammarIssues(review).filter((entry) => value.categories[entry.category] >= 2)
        .sort((a, b) => value.categories[b.category] - value.categories[a.category])[0];
      if (!issue) return null;
      if (issue.category === "word_order" && value.wordOrderSubcategories[issue.subcategory] >= 2 && orderTips[issue.subcategory]) return orderTips[issue.subcategory];
      return tips[issue.category];
    },
    resetLearningHistory() {
      state = empty();
      write();
    },
  };
}
