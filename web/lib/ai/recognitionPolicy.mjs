// Provider scores are evidence, not calibrated probabilities of correctness.
// Keep the review cutoff and optional reference-style checks in one place.
export const RECOGNITION_POLICY = Object.freeze({ reviewBelow: 0.60, blockingShapeChecks: false });
export const needsRecognitionReview = (confidence) => confidence == null || confidence < RECOGNITION_POLICY.reviewBelow;
export const isPunctuationOnly = (text) => typeof text === "string" && /^[\p{Punctuation}\s]+$/u.test(text) && !!text.trim();
