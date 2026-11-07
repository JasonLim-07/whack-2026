import { renderStrokesToPng } from "./pngUtils.js";

/**
 * Normalized stroke polylines (in a 0..100 x 0..100 character box) for our benchmark Chinese characters.
 * Each sub-array is a single stroke of [x, y] coordinates simulating natural mouse/stylus handwriting.
 */
const CHAR_GLYPH_STROKES = {
  我: [
    [[35, 16], [16, 26]],
    [[10, 42], [88, 38]],
    [[28, 22], [28, 86], [20, 78]],
    [[10, 68], [44, 52]],
    [[54, 12], [58, 56], [72, 84], [88, 90], [86, 72]],
    [[82, 46], [54, 74]],
    [[72, 16], [82, 26]],
  ],
  是: [
    [[26, 12], [26, 42]],
    [[26, 12], [72, 12], [72, 42]],
    [[26, 27], [70, 27]],
    [[26, 42], [72, 42]],
    [[12, 54], [88, 54]],
    [[50, 54], [50, 82]],
    [[50, 68], [76, 68]],
    [[28, 64], [14, 88]],
    [[24, 72], [56, 86], [88, 90]],
  ],
  学: [
    [[24, 12], [32, 24]],
    [[46, 10], [50, 22]],
    [[74, 10], [64, 24]],
    [[16, 28], [14, 44]],
    [[16, 28], [84, 28], [76, 42]],
    [[30, 42], [68, 42], [50, 56]],
    [[50, 56], [52, 88], [40, 80]],
    [[14, 68], [86, 66]],
  ],
  生: [
    [[30, 20], [16, 52]],
    [[24, 38], [80, 38]],
    [[24, 62], [76, 62]],
    [[50, 12], [50, 88]],
    [[12, 88], [88, 88]],
  ],
  有: [
    [[12, 26], [88, 26]],
    [[48, 10], [32, 44], [12, 72]],
    [[34, 42], [34, 90]],
    [[34, 42], [74, 42], [74, 88], [64, 82]],
    [[34, 58], [72, 58]],
    [[34, 72], [72, 72]],
  ],
  三: [
    [[20, 24], [80, 24]],
    [[26, 52], [74, 52]],
    [[12, 82], [88, 82]],
  ],
  书: [
    [[20, 26], [74, 26], [72, 48]],
    [[12, 50], [88, 50], [82, 78], [68, 70]],
    [[48, 10], [48, 92]],
    [[70, 14], [80, 22]],
  ],
  你: [
    [[32, 14], [12, 52]],
    [[24, 36], [24, 90]],
    [[56, 14], [40, 42]],
    [[48, 28], [86, 28], [76, 44]],
    [[64, 32], [64, 88], [54, 80]],
    [[46, 56], [36, 78]],
    [[76, 56], [88, 78]],
  ],
  爱: [
    [[72, 10], [24, 20]],
    [[24, 26], [32, 36]],
    [[48, 22], [52, 34]],
    [[76, 20], [66, 34]],
    [[16, 40], [14, 54]],
    [[16, 40], [84, 40], [76, 52]],
    [[18, 56], [82, 56]],
    [[44, 44], [22, 84]],
    [[36, 66], [68, 66], [32, 90]],
    [[34, 72], [84, 92]],
  ],
  今: [
    [[50, 12], [12, 56]],
    [[50, 12], [88, 56]],
    [[36, 46], [64, 46]],
    [[24, 66], [76, 66], [54, 90]],
  ],
  天: [
    [[20, 24], [80, 24]],
    [[14, 50], [86, 50]],
    [[50, 24], [46, 56], [16, 88]],
    [[50, 52], [86, 88]],
  ],
  去: [
    [[24, 34], [76, 34]],
    [[50, 12], [50, 56]],
    [[12, 56], [88, 56]],
    [[48, 56], [24, 84], [74, 82]],
    [[66, 68], [82, 90]],
  ],
  了: [
    [[18, 20], [80, 20], [52, 46]],
    [[52, 46], [54, 88], [38, 78]],
  ],
  校: [
    [[10, 38], [42, 38]],
    [[26, 12], [26, 90]],
    [[26, 42], [10, 72]],
    [[26, 46], [40, 62]],
    [[62, 12], [68, 24]],
    [[44, 28], [88, 28]],
    [[56, 36], [44, 54]],
    [[74, 36], [86, 54]],
    [[76, 48], [44, 88]],
    [[52, 54], [88, 88]],
  ],
  "。": [
    [
      [20, 72],
      [32, 72],
      [32, 84],
      [20, 84],
      [20, 72],
    ],
  ],
};

/**
 * Builds a structured handwriting snapshot (matching docs/SPEC.md) and PNG export for a sentence.
 */
export function buildHandwritingFixture(sentence, options = {}) {
  const charSize = options.charSize || 76;
  const charSpacing = options.charSpacing || 92;
  const startX = options.startX || 40;
  const startY = options.startY || 60;
  const wobble = options.wobble || 0;

  const strokes = [];
  let strokeCounter = 1;

  const chars = Array.from(sentence);
  chars.forEach((ch, charIdx) => {
    const glyph = CHAR_GLYPH_STROKES[ch] || CHAR_GLYPH_STROKES["。"];
    const offsetX = startX + charIdx * charSpacing;
    const offsetY = startY + (wobble ? ((charIdx % 2) * 2 - 1) * wobble : 0);

    for (const rawPoints of glyph) {
      const points = [];
      for (let i = 0; i < rawPoints.length - 1; i += 1) {
        const [x0, y0] = rawPoints[i];
        const [x1, y1] = rawPoints[i + 1];
        const steps = 6;
        for (let s = 0; s <= steps; s += 1) {
          if (i > 0 && s === 0) continue;
          const tRatio = s / steps;
          const px = offsetX + ((x0 + (x1 - x0) * tRatio) / 100) * charSize;
          const py = offsetY + ((y0 + (y1 - y0) * tRatio) / 100) * charSize;
          points.push({
            x: Math.round(px * 10) / 10,
            y: Math.round(py * 10) / 10,
            t: points.length * 16,
            pressure: 0.55,
          });
        }
      }

      strokes.push({
        id: `stroke-${strokeCounter}`,
        pointerType: "pen",
        points,
      });
      strokeCounter += 1;
    }
  });

  const canvasWidth = Math.max(800, startX * 2 + chars.length * charSpacing);
  const canvasHeight = 240;

  const writing = {
    version: 1,
    writingId: options.writingId || "fixture-writing-1",
    revision: 1,
    canvas: { width: canvasWidth, height: canvasHeight },
    strokes,
  };

  const png = renderStrokesToPng(strokes);

  return {
    expectedText: sentence,
    writing,
    pngBuffer: png.buffer,
    pngBase64: png.base64,
    dataUrl: png.dataUrl,
  };
}

export const BENCHMARK_CASES = [
  {
    id: "correct-basic",
    description: "Correct sentence (我是学生。)",
    sentence: "我是学生。",
  },
  {
    id: "missing-measure-word",
    description: "Missing measure word 本 — must NOT auto-correct (我有三书。)",
    sentence: "我有三书。",
  },
  {
    id: "wrong-word-order",
    description: "Incorrect word order — must NOT reorder (我你爱。)",
    sentence: "我你爱。",
  },
  {
    id: "longer-sentence",
    description: "Longer sentence with baseline drift (我今天去了学校。)",
    sentence: "我今天去了学校。",
    wobble: 8,
  },
];
