import {
  callCloudVisionOcr,
  callGeminiVisionOcr,
  clearTranscriptionCache,
  normalizeOcrResult,
  parseConfidence,
  prepareRecognitionInput,
  transcribeHandwriting,
} from "./transcribe.js";

export const recognizeHandwriting = transcribeHandwriting;
export const recogniseHandwriting = transcribeHandwriting;
export const transcribe = transcribeHandwriting;

export {
  callCloudVisionOcr,
  callGeminiVisionOcr,
  clearTranscriptionCache,
  normalizeOcrResult,
  parseConfidence,
  prepareRecognitionInput,
  transcribeHandwriting,
};

export default recognizeHandwriting;
