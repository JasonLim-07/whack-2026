import { renderStrokesToPng } from "./pngUtils.js";

/**
 * Normalized stroke polylines (in a 0..100 x 0..100 character box) for synthetic handwriting tests.
 * NOTE: These are synthetic vector stroke templates, not human handwriting samples.
 */
export const CHAR_GLYPH_STROKES = {
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
  二: [
    [[24, 34], [76, 34]],
    [[12, 76], [88, 76]],
  ],
  一: [
    [[12, 52], [88, 50]],
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
  中: [
    [[20, 30], [20, 62]],
    [[20, 30], [80, 30], [80, 62]],
    [[20, 62], [80, 62]],
    [[50, 10], [50, 92]],
  ],
  文: [
    [[46, 12], [54, 24]],
    [[14, 28], [86, 28]],
    [[68, 28], [48, 64], [16, 88]],
    [[28, 38], [52, 66], [86, 88]],
  ],
  人: [
    [[52, 16], [36, 56], [14, 88]],
    [[46, 40], [66, 68], [88, 88]],
  ],
  大: [
    [[14, 40], [86, 40]],
    [[50, 14], [46, 54], [14, 88]],
    [[50, 48], [86, 88]],
  ],
  太: [
    [[14, 38], [86, 38]],
    [[50, 12], [46, 52], [14, 88]],
    [[50, 46], [86, 88]],
    [[44, 72], [56, 84]],
  ],
  口: [
    [[22, 24], [22, 80]],
    [[22, 24], [78, 24], [78, 80]],
    [[22, 80], [78, 80]],
  ],
  日: [
    [[24, 16], [24, 86]],
    [[24, 16], [76, 16], [76, 86]],
    [[24, 50], [74, 50]],
    [[24, 86], [76, 86]],
  ],
  目: [
    [[24, 14], [24, 88]],
    [[24, 14], [76, 14], [76, 88]],
    [[24, 38], [74, 38]],
    [[24, 62], [74, 62]],
    [[24, 88], [76, 88]],
  ],
  木: [
    [[14, 36], [86, 36]],
    [[50, 12], [50, 90]],
    [[50, 38], [16, 82]],
    [[50, 38], [84, 82]],
  ],
  本: [
    [[14, 34], [86, 34]],
    [[50, 10], [50, 92]],
    [[50, 34], [14, 80]],
    [[50, 34], [86, 80]],
    [[28, 72], [72, 72]],
  ],
  未: [
    [[24, 28], [76, 28]],
    [[12, 48], [88, 48]],
    [[50, 10], [50, 92]],
    [[50, 48], [14, 84]],
    [[50, 48], [86, 84]],
  ],
  末: [
    [[12, 28], [88, 28]],
    [[26, 48], [74, 48]],
    [[50, 10], [50, 92]],
    [[50, 48], [14, 84]],
    [[50, 48], [86, 84]],
  ],
  王: [
    [[20, 20], [80, 20]],
    [[50, 20], [50, 84]],
    [[24, 50], [76, 50]],
    [[12, 84], [88, 84]],
  ],
  玉: [
    [[20, 20], [80, 20]],
    [[50, 20], [50, 84]],
    [[24, 50], [76, 50]],
    [[12, 84], [88, 84]],
    [[66, 62], [78, 74]],
  ],
  不: [
    [[14, 22], [86, 22]],
    [[54, 22], [14, 72]],
    [[50, 42], [50, 90]],
    [[58, 48], [86, 76]],
  ],
  好: [
    [[26, 16], [14, 56], [42, 74]],
    [[38, 32], [28, 68], [12, 86]],
    [[8, 44], [44, 40]],
    [[52, 20], [84, 20], [66, 42]],
    [[66, 42], [68, 88], [56, 80]],
    [[46, 54], [90, 52]],
  ],
  吃: [
    [[12, 30], [12, 66]],
    [[12, 30], [34, 30], [34, 66]],
    [[12, 66], [34, 66]],
    [[52, 14], [38, 44]],
    [[46, 28], [84, 28]],
    [[44, 50], [78, 46], [52, 78], [58, 88], [88, 88], [86, 70]],
  ],
  个: [
    [[50, 14], [14, 60]],
    [[50, 14], [86, 60]],
    [[50, 44], [50, 90]],
  ],
  上: [
    [[50, 14], [50, 84]],
    [[50, 46], [78, 46]],
    [[12, 84], [88, 84]],
  ],
  下: [
    [[12, 20], [88, 20]],
    [[50, 20], [50, 90]],
    [[54, 46], [78, 64]],
  ],
  "1": [
    [[48, 16], [48, 86]],
  ],
  "0": [
    [
      [50, 16],
      [26, 28],
      [22, 52],
      [26, 76],
      [50, 86],
      [74, 76],
      [78, 52],
      [74, 28],
      [50, 16],
    ],
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
  "，": [
    [
      [26, 68],
      [30, 76],
      [20, 90],
    ],
  ],
};

function seededNoise(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

/**
 * Builds a structured handwriting snapshot (matching docs/SPEC.md) and PNG export for a sentence
 * or multi-line array of sentences, with configurable handwriting distortions.
 */
export function buildHandwritingFixture(sentenceOrLines, options = {}) {
  const lines = Array.isArray(sentenceOrLines)
    ? sentenceOrLines
    : String(sentenceOrLines).split("\n");
  const expectedText = lines.join("");

  const baseCharSize = options.charSize || 76;
  const charSpacing = options.charSpacing || 92;
  const lineSpacing = options.lineSpacing || 115;
  const startX = options.startX || 40;
  const startY = options.startY || 50;
  const wobble = options.wobble || 0;
  const jitter = options.jitter || 0;
  const slant = options.slant || 0;
  const scalePattern = options.scalePattern || null;
  const dropStrokes = options.dropStrokes || [];

  const strokes = [];
  let strokeCounter = 1;
  let globalCharIdx = 0;
  let maxRowLen = 0;

  lines.forEach((lineText, lineIdx) => {
    const chars = Array.from(lineText);
    if (chars.length > maxRowLen) maxRowLen = chars.length;

    let cursorX = startX;
    chars.forEach((ch, colIdx) => {
      const glyph = CHAR_GLYPH_STROKES[ch] || CHAR_GLYPH_STROKES["。"];
      const scale =
        Array.isArray(scalePattern) && scalePattern.length > 0
          ? scalePattern[globalCharIdx % scalePattern.length]
          : 1;
      const charSize = baseCharSize * scale;
      const offsetY =
        startY +
        lineIdx * lineSpacing +
        (wobble ? Math.sin(globalCharIdx * 1.7) * wobble : 0);

      glyph.forEach((rawPoints, strokeIdx) => {
        const shouldDrop = dropStrokes.some(
          (d) => d.charIndex === globalCharIdx && d.strokeIndex === strokeIdx
        );
        if (shouldDrop) {
          return;
        }

        const points = [];
        for (let i = 0; i < rawPoints.length - 1; i += 1) {
          const [x0, y0] = rawPoints[i];
          const [x1, y1] = rawPoints[i + 1];
          const steps = 6;
          for (let s = 0; s <= steps; s += 1) {
            if (i > 0 && s === 0) continue;
            const tRatio = s / steps;
            const normX = x0 + (x1 - x0) * tRatio;
            const normY = y0 + (y1 - y0) * tRatio;

            const shearX = slant ? (50 - normY) * slant : 0;
            const noiseX = jitter
              ? seededNoise(strokeCounter * 100 + points.length * 7 + colIdx) *
                jitter *
                2
              : 0;
            const noiseY = jitter
              ? seededNoise(strokeCounter * 200 + points.length * 13 + colIdx) *
                jitter *
                2
              : 0;

            const px =
              cursorX + ((normX + shearX) / 100) * charSize + noiseX;
            const py = offsetY + (normY / 100) * charSize + noiseY;

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
          pointerType: options.pointerType || "pen",
          points,
        });
        strokeCounter += 1;
      });

      cursorX += charSpacing * scale;
      globalCharIdx += 1;
    });
  });

  const canvasWidth = Math.max(800, startX * 2 + maxRowLen * charSpacing + 60);
  const canvasHeight = Math.max(
    240,
    startY * 2 + lines.length * lineSpacing + 40
  );

  const writing = {
    version: 1,
    writingId: options.writingId || "fixture-writing-1",
    revision: options.revision || 1,
    canvas: { width: canvasWidth, height: canvasHeight },
    strokes,
  };

  const png = renderStrokesToPng(strokes);

  return {
    expectedText,
    writing,
    pngBuffer: png.buffer,
    pngBase64: png.base64,
    dataUrl: png.dataUrl,
  };
}

export const BENCHMARK_CASES = [
  // Category 1: Core Baseline & Grammar Error Preservation
  {
    id: "01-correct-student",
    category: "Baseline",
    description: "Correct basic sentence (我是学生。)",
    sentence: "我是学生。",
  },
  {
    id: "02-missing-measure-word-shu",
    category: "Grammar Mistake Preservation",
    description: "Missing measure word 本 — must NOT auto-correct (我有三书。)",
    sentence: "我有三书。",
  },
  {
    id: "03-missing-measure-word-ren",
    category: "Grammar Mistake Preservation",
    description: "Missing measure word 个 — must NOT auto-correct (三学生。)",
    sentence: "三学生。",
  },
  {
    id: "04-wrong-word-order-sov",
    category: "Grammar Mistake Preservation",
    description: "Incorrect SOV word order — must NOT reorder (我你爱。)",
    sentence: "我你爱。",
  },
  {
    id: "05-wrong-negation-you",
    category: "Grammar Mistake Preservation",
    description: "Wrong negation 不有 instead of 没有 — must preserve literally (我不有书。)",
    sentence: "我不有书。",
  },
  {
    id: "06-wrong-adverb-order",
    category: "Grammar Mistake Preservation",
    description: "Misplaced time word — must preserve literally (我去今天学校。)",
    sentence: "我去今天学校。",
  },

  // Category 2: Messy / Shaky Mouse & Trackpad Handwriting
  {
    id: "07-shaky-mouse-tremor",
    category: "Messy Handwriting",
    description: "Shaky mouse tremor + baseline wobble (我今天去了学校。)",
    sentence: "我今天去了学校。",
    jitter: 1.4,
    wobble: 10,
  },
  {
    id: "08-slanted-fast-writing",
    category: "Messy Handwriting",
    description: "Forward-slanted fast writing with drift (我爱中文。)",
    sentence: "我爱中文。",
    slant: 0.14,
    jitter: 1.0,
    wobble: 6,
  },
  {
    id: "09-back-slanted-jitter",
    category: "Messy Handwriting",
    description: "Backward-slanted shaky writing (你是好人。)",
    sentence: "你是好人。",
    slant: -0.12,
    jitter: 1.2,
  },

  // Category 3: Spacing & Size Variations
  {
    id: "10-crowded-spacing",
    category: "Spacing & Sizing",
    description: "Characters written very close together (我有三本书。)",
    sentence: "我有三本书。",
    charSize: 78,
    charSpacing: 74,
  },
  {
    id: "11-wide-spacing",
    category: "Spacing & Sizing",
    description: "Characters written with large horizontal gaps (我学中文。)",
    sentence: "我学中文。",
    charSize: 72,
    charSpacing: 135,
  },
  {
    id: "12-mixed-character-sizes",
    category: "Spacing & Sizing",
    description: "Alternating large and small character sizes (大人生日。)",
    sentence: "大人生日。",
    scalePattern: [1.25, 0.78, 1.2, 0.82, 1.0],
  },

  // Category 4: Lookalike Characters & Numbers vs Chinese Characters
  {
    id: "13-lookalike-da-tai-tian",
    category: "Lookalike & Numbers",
    description: "Distinguishing 大 vs 太 vs 天 in one sequence (大太天。)",
    sentence: "大太天。",
  },
  {
    id: "14-lookalike-mu-ben-wei-mo",
    category: "Lookalike & Numbers",
    description: "Distinguishing 木 vs 本 vs 未 vs 末 (木本未末。)",
    sentence: "木本未末。",
  },
  {
    id: "15-lookalike-kou-ri-mu",
    category: "Lookalike & Numbers",
    description: "Distinguishing 口 vs 日 vs 目 (口日目。)",
    sentence: "口日目。",
  },
  {
    id: "16-lookalike-wang-yu",
    category: "Lookalike & Numbers",
    description: "Distinguishing 王 vs 玉 and 上 vs 下 (王玉上下。)",
    sentence: "王玉上下。",
  },
  {
    id: "17-numbers-sequence",
    category: "Lookalike & Numbers",
    description: "Horizontal stroke counts 一二三 (一二三个人。)",
    sentence: "一二三个人。",
  },
  {
    id: "18-arabic-number-preserved",
    category: "Lookalike & Numbers",
    description: "Genuine Arabic number 10 in Chinese sentence — must NOT turn 0 into 口 (我有10本书。)",
    sentence: "我有10本书。",
  },

  // Category 5: Multi-Line Canvas Writing
  {
    id: "19-two-line-paragraph",
    category: "Multi-Line",
    description: "Two-line handwritten paragraph on canvas",
    sentence: "我是学生，\n我爱中文。",
  },
];
