export const GRAMMAR_CATEGORIES = Object.freeze([
  "measure_word", "word_order", "particle", "missing_word", "verb_usage", "other",
]);
export const WORD_ORDER_SUBCATEGORIES = Object.freeze([
  "time_placement", "location_placement", "question_word_placement", "other",
]);

// Legacy issues may omit both fields; supplied classifications must be valid.
export function validIssueCategory(issue) {
  return (issue.category === undefined || GRAMMAR_CATEGORIES.includes(issue.category)) &&
    (issue.subcategory === undefined || (issue.category === "word_order" && WORD_ORDER_SUBCATEGORIES.includes(issue.subcategory)));
}
