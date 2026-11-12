// Char Avatar Dropper: color math. No DOM, so the tests can load it in Node.
//
// Pixel buffers are RGBA Uint8ClampedArray-like arrays (ImageData.data layout).

const CADCore = (() => {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");

  /** [r, g, b] (0-255) to "#rrggbb". */
  const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

  /** "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa" to [r, g, b], or null. Alpha is dropped. */
  function parseHex(value) {
    const match = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(value ?? "").trim());
    if (!match) return null;
    let digits = match[1];
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  }

  /** [r, g, b] to [h (0-360), s (0-1), v (0-1)]. */
  function rgbToHsv([r, g, b]) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max / 255];
  }

  /** Relative luminance (WCAG), 0-1. */
  function luminance([r, g, b]) {
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  /** Black or white, whichever reads better on `rgb`. */
  const textOn = (rgb) => (luminance(rgb) > 0.4 ? "#000000" : "#ffffff");

  /**
   * Alpha-weighted average color of the square of `radius` around (x, y).
   * Transparent pixels don't count. Null if every pixel there is transparent
   * or (x, y) is off the image.
   */
  function averageAt(data, width, height, x, y, radius = 0) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy += 1) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
        const i = (yy * width + xx) * 4;
        const a = data[i + 3];
        if (a < 16) continue;
        r += data[i] * a;
        g += data[i + 1] * a;
        b += data[i + 2] * a;
        weight += a;
      }
    }
    return weight ? [r / weight, g / weight, b / weight].map(Math.round) : null;
  }

  /**
   * "skin", "neutral" or "color". A rough guess, used to sort swatches, never
   * to hide them: skin is warm (red > green > blue-ish, hue 0-50°), not very
   * saturated (less so the lighter it is) and not dark. Neutral is grey,
   * near black, very dark and muted, or near white.
   */
  function classify(rgb) {
    const [h, s, v] = rgbToHsv(rgb);
    if (v < 0.13 || s < 0.1 || (v > 0.94 && s < 0.12) || (v < 0.25 && s < 0.45)) return "neutral";
    const [r, g, b] = rgb;
    const warm = r > g && g >= b * 0.8 && r - b > 15;
    // Darker skin is more saturated, so the limit rises as the value drops.
    if (warm && (h <= 50 || h >= 352) && s >= 0.1 && s <= 0.62 + (1 - v) * 0.5 && v >= 0.38) return "skin";
    return "color";
  }

  // Small deterministic PRNG, so the same image always gives the same swatches.
  function mulberry32(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  /** Opaque pixels on an even grid, at most `max` of them. */
  function samplePixels(data, width, height, max) {
    const step = Math.max(1, Math.sqrt((width * height) / max));
    const out = [];
    for (let y = step / 2; y < height; y += step) {
      for (let x = step / 2; x < width; x += step) {
        const i = (Math.floor(y) * width + Math.floor(x)) * 4;
        if (data[i + 3] < 128) continue;
        out.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
    return out;
  }

  /**
   * Suggested swatches: k-means over the image, near-duplicates merged, then
   * sorted so distinct, saturated colors (hair, eyes, outfit) come first and
   * skin and neutrals last. Each: { hex, rgb, share (0-1), kind }.
   */
  function palette(data, width, height, { k = 12, maxSamples = 6000, rounds = 14, minShare = 0.004 } = {}) {
    const pixels = samplePixels(data, width, height, maxSamples);
    if (!pixels.length) return [];
    const random = mulberry32(pixels.length * 2654435761);

    // k-means++ seeding.
    const centers = [pixels[Math.floor(random() * pixels.length)].slice()];
    const nearest = pixels.map((p) => dist2(p, centers[0]));
    while (centers.length < Math.min(k, pixels.length)) {
      const total = nearest.reduce((sum, d) => sum + d, 0);
      if (!total) break;
      let pick = random() * total;
      let index = 0;
      while (index < pixels.length - 1 && (pick -= nearest[index]) > 0) index += 1;
      const center = pixels[index].slice();
      centers.push(center);
      for (let i = 0; i < pixels.length; i += 1) nearest[i] = Math.min(nearest[i], dist2(pixels[i], center));
    }

    const assign = new Int32Array(pixels.length);
    for (let round = 0; round < rounds; round += 1) {
      const sums = centers.map(() => [0, 0, 0, 0]);
      let moved = 0;
      for (let i = 0; i < pixels.length; i += 1) {
        let best = 0;
        let bestD = Infinity;
        for (let c = 0; c < centers.length; c += 1) {
          const d = dist2(pixels[i], centers[c]);
          if (d < bestD) (bestD = d), (best = c);
        }
        if (assign[i] !== best) (assign[i] = best), (moved += 1);
        const s = sums[best];
        s[0] += pixels[i][0];
        s[1] += pixels[i][1];
        s[2] += pixels[i][2];
        s[3] += 1;
      }
      sums.forEach((s, c) => {
        if (s[3]) centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      });
      if (!moved && round) break;
    }

    let clusters = centers
      .map((center, c) => ({ rgb: center, count: 0, c }))
      .map((cluster) => {
        for (let i = 0; i < assign.length; i += 1) if (assign[i] === cluster.c) cluster.count += 1;
        return cluster;
      })
      .filter((cluster) => cluster.count);

    // Merge clusters that look the same (biggest absorbs smaller).
    clusters.sort((a, b) => b.count - a.count);
    const merged = [];
    for (const cluster of clusters) {
      const twin = merged.find((m) => dist2(m.rgb, cluster.rgb) < 22 * 22);
      if (!twin) {
        merged.push({ ...cluster });
        continue;
      }
      const total = twin.count + cluster.count;
      twin.rgb = twin.rgb.map((v, i) => (v * twin.count + cluster.rgb[i] * cluster.count) / total);
      twin.count = total;
    }

    const RANK = { color: 0, skin: 1, neutral: 2 };
    return merged
      .map((cluster) => {
        const rgb = cluster.rgb.map(Math.round);
        const [, s, v] = rgbToHsv(rgb);
        const share = cluster.count / pixels.length;
        return { hex: toHex(rgb), rgb, share, kind: classify(rgb), score: s * (0.4 + 0.6 * v) * share ** 0.25 };
      })
      .filter((swatch) => swatch.share >= minShare)
      .sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.kind === "color" ? b.score - a.score : b.share - a.share))
      .map(({ score, ...swatch }) => swatch);
  }

  /** CSS linear-gradient from 2+ hex stops, or the single stop itself. */
  function gradient(stops, angle = 90) {
    if (stops.length < 2) return stops[0] ?? "";
    return `linear-gradient(${angle}deg, ${stops.join(", ")})`;
  }

  /** Hex stops out of a "linear-gradient(...)" string (only #hex stops are kept). */
  function gradientStops(value) {
    if (!/^linear-gradient\(/i.test(String(value ?? "").trim())) return [];
    return [...String(value).matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => {
      const rgb = parseHex(m[0]);
      return rgb ? toHex(rgb) : null;
    }).filter(Boolean);
  }

  return Object.freeze({ toHex, parseHex, rgbToHsv, luminance, textOn, averageAt, classify, palette, gradient, gradientStops });
})();
