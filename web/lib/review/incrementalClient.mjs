import { validateReview } from "./client.mjs";
import { validateRecognition } from "./transcription.mjs";

async function send(endpoint, body, revision, signal, validate) {
  let response;
  try { response = await fetch(endpoint, { method: "POST", body, signal,
    ...(typeof body === "string" ? { headers: { "content-type": "application/json" } } : {}) }); }
  catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Could not reach the checker. Please retry.");
  }
  let result;
  try { result = await response.json(); } catch { throw new Error("The checker returned an unreadable response."); }
  if (!response.ok) throw new Error(result?.error?.message || "The checker could not complete this request.");
  return validate(result, revision);
}

export function requestRegion(snapshot, signal) {
  const form = new FormData();
  form.append("image", snapshot.image, "handwriting-region.png");
  form.append("revision", String(snapshot.revision));
  form.append("spatial", JSON.stringify(snapshot.spatial));
  return send("/api/recognition", form, snapshot.revision, signal, validateRecognition);
}

export function requestGrammar(text, revision, signal, level = "gcse") {
  return send("/api/grammar", JSON.stringify({ text, revision, level }), revision, signal, validateReview);
}
