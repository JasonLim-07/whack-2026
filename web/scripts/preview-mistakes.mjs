// Development-only fixture proxy. Production routes and credentials are untouched.
// Start Next on port 3000, then run this file and open http://127.0.0.1:3100.
import http from "node:http";
import { Buffer } from "node:buffer";

http.createServer(async (request, response) => {
  if (request.method === "POST" && ["/api/review", "/api/recognition", "/api/grammar"].includes(request.url)) {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      const headers = { "content-type": request.headers["content-type"] };
      let result;
      if (headers["content-type"].includes("application/json")) {
        const { text, revision } = JSON.parse(bytes.toString());
        result = { recognizedText: text, correctedText: text, revision, issues: [], ocrConfidence: null, ocrSegments: [], ocrCharacters: [] };
        if (text.includes("三书")) {
          const start = Array.from(text.slice(0, text.indexOf("三书"))).length + 1;
          result.correctedText = text.replace("三书", "三本书");
          result.issues = [{ id: "measure-word", type: "grammar", start, end: start, original: "", replacement: "本", explanation: "Use 本 as the measure word for books." }];
        }
      } else {
        const form = await new Response(bytes, { headers }).formData();
        const png = Buffer.from(await form.get("image").arrayBuffer());
        const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
        const bounds = { x: 0, y: 0, width, height };
        result = { recognizedText: "末", revision: Number(form.get("revision")), status: "LOW_CONFIDENCE", requiresVerification: true,
          ocrConfidence: null, ocrSegments: [{ text: "末", confidence: 0.75 }],
          ocrCharacters: [{ text: "末", start: 0, end: 1, bounds }],
          characterCandidates: [{ position: 0, originalAttempt: "末", confidence: 0.75,
            options: [{ char: "末", reason: "Fixture original" }, { char: "未", reason: "Fixture alternative" }] }] };
      }
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(result));
    } catch {
      response.writeHead(400); response.end("Invalid preview request");
    }
    return;
  }
  // Avoid real intent/provider calls in this fixture environment.
  if (request.url === "/api/intent") { response.writeHead(503); response.end(); return; }
  const upstream = http.request({ hostname: "127.0.0.1", port: 3000, path: request.url, method: request.method,
    headers: { ...request.headers, host: "127.0.0.1:3000" } }, (incoming) => {
    response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
  });
  upstream.on("error", () => { response.writeHead(502); response.end("Start Next on port 3000 first."); });
  request.pipe(upstream);
}).listen(3100, "127.0.0.1", () => console.log("Fixture-only handwriting preview: http://127.0.0.1:3100 (no OCR/LLM calls)"));
