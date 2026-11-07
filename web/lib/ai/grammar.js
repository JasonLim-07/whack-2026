const ISSUE_TYPES = new Set(["grammar", "word_choice", "character"]);

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}

function requireText(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new TypeError("text must be a non-empty string.");
  }
}

function requireString(value, field, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new TypeError(
      `Invalid grammar response: ${field} must be ${allowEmpty ? "a string" : "a non-empty string"}.`,
    );
  }
  return value;
}

/**
 * Validate a parsed provider response and return only the grammar contract fields.
 * Preserve text verbatim, including whitespace; never rewrite issue-free input.
 * Empty original/replacement strings allow insertions/deletions respectively.
 */
export function validateGrammarResponse(response, originalText) {
  requireText(originalText);

  if (!isObject(response)) {
    throw new TypeError("Invalid grammar response: expected an object.");
  }

  const correctedText = requireString(response.correctedText, "correctedText");
  if (!Array.isArray(response.issues)) {
    throw new TypeError("Invalid grammar response: issues must be an array.");
  }

  const ids = new Set();
  const issues = Array.from(response.issues, (issue, index) => {
    const path = `issues[${index}]`;
    if (!isObject(issue)) {
      throw new TypeError(`Invalid grammar response: ${path} must be an object.`);
    }

    const id = requireString(issue.id, `${path}.id`);
    if (ids.has(id)) {
      throw new TypeError(`Invalid grammar response: ${path}.id must be unique.`);
    }
    ids.add(id);

    if (!ISSUE_TYPES.has(issue.type)) {
      throw new TypeError(
        `Invalid grammar response: ${path}.type must be grammar, word_choice or character.`,
      );
    }

    return {
      id,
      type: issue.type,
      original: requireString(issue.original, `${path}.original`, true),
      replacement: requireString(issue.replacement, `${path}.replacement`, true),
      explanation: requireString(issue.explanation, `${path}.explanation`),
    };
  });

  return {
    correctedText: issues.length === 0 ? originalText : correctedText,
    issues,
  };
}

/**
 * Analyse recognised Chinese text with an optional learner level (beginner by
 * default). Provider integration is intentionally deferred to Milestone 2.
 */
export async function analyseGrammar(text, options = {}) {
  requireText(text);
  if (!isObject(options)) {
    throw new TypeError("options must be an object.");
  }

  const { level = "beginner" } = options;
  if (typeof level !== "string" || level.trim() === "") {
    throw new TypeError("options.level must be a non-empty string.");
  }

  throw new Error("Grammar LLM provider is not configured yet (Milestone 2).");
}
