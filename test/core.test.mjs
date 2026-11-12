import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { PARTS, fakeAvatar } from "../dev/fake-avatar.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(ROOT, "extension/src/core.js"), "utf8");
const CADCore = vm.runInNewContext(`${source}\nCADCore;`, {}, { filename: "core.js" });

test("hex parsing and formatting", () => {
  assert.deepEqual([...CADCore.parseHex("#abc")], [170, 187, 204]);
  assert.deepEqual([...CADCore.parseHex("7b2ff7")], [123, 47, 247]);
  assert.deepEqual([...CADCore.parseHex("#7b2ff780")], [123, 47, 247]);
  assert.equal(CADCore.parseHex("rgb(1,2,3)"), null);
  assert.equal(CADCore.parseHex(""), null);
  assert.equal(CADCore.toHex([123, 47, 247]), "#7b2ff7");
  assert.equal(CADCore.toHex([300, -4, 15.6]), "#ff0010");
});

test("hsv", () => {
  assert.deepEqual([...CADCore.rgbToHsv([255, 0, 0])], [0, 1, 1]);
  const [h, s, v] = CADCore.rgbToHsv([0, 0, 255]);
  assert.equal(h, 240);
  assert.equal(s, 1);
  assert.equal(v, 1);
  assert.deepEqual([...CADCore.rgbToHsv([0, 0, 0])], [0, 0, 0]);
});

test("averageAt averages the square and ignores transparent pixels", () => {
  const width = 3;
  const height = 3;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < 9; i += 1) data.set([i * 10, 0, 0, 255], i * 4);
  data.set([0, 0, 0, 0], 0); // top-left transparent
  assert.deepEqual([...CADCore.averageAt(data, width, height, 1, 1, 0)], [40, 0, 0]);
  // 3×3 without the transparent pixel: (10+20+...+80)/8 = 45
  assert.deepEqual([...CADCore.averageAt(data, width, height, 1, 1, 1)], [45, 0, 0]);
  // Corner with radius clamps to the image.
  assert.deepEqual([...CADCore.averageAt(data, width, height, 2, 2, 1)], [60, 0, 0]);
  assert.equal(CADCore.averageAt(data, width, height, 0, 0, 0), null);
  assert.equal(CADCore.averageAt(data, width, height, -1, 0, 1), null);
  assert.equal(CADCore.averageAt(data, width, height, 3, 0, 1), null);
});

test("classify skin, neutral and color", () => {
  for (const skin of [[241, 199, 165], [224, 172, 105], [198, 134, 66], [255, 219, 172], [141, 85, 36]]) {
    assert.equal(CADCore.classify(skin), "skin", `skin ${skin}`);
  }
  for (const neutral of [[0, 0, 0], [20, 20, 22], [128, 128, 128], [250, 250, 250], [200, 200, 205]]) {
    assert.equal(CADCore.classify(neutral), "neutral", `neutral ${neutral}`);
  }
  for (const color of [[123, 47, 247], [230, 57, 70], [25, 195, 125], [30, 90, 200], [255, 215, 0], [220, 20, 60]]) {
    assert.equal(CADCore.classify(color), "color", `color ${color}`);
  }
});

test("palette puts hair and outfit before skin", () => {
  const { data, width, height } = fakeAvatar();
  const swatches = CADCore.palette(data, width, height);
  assert.ok(swatches.length >= 4, "found the main regions");
  const near = (rgb, target) => Math.hypot(rgb[0] - target[0], rgb[1] - target[1], rgb[2] - target[2]) < 20;
  const index = (part) => swatches.findIndex((s) => near(s.rgb, PARTS[part]));
  for (const part of ["hair", "outfit", "skin", "background"]) assert.ok(index(part) >= 0, `${part} present`);
  assert.equal(swatches[index("skin")].kind, "skin");
  assert.equal(swatches[index("background")].kind, "neutral");
  assert.ok(index("hair") < index("skin"), "hair before skin");
  assert.ok(index("outfit") < index("skin"), "outfit before skin");
  // Eyes are tiny but still found, ahead of skin.
  assert.ok(index("eyes") >= 0 && index("eyes") < index("skin"), "eyes before skin");
  // Skin is the biggest non-background region, which is why the built-in extract picks it.
  const skinShare = swatches[index("skin")].share;
  assert.ok(swatches.filter((s) => s.kind !== "neutral").every((s) => s.share <= skinShare + 1e-9));
  // Shares add up to (about) the whole image, minus dropped tiny clusters.
  const total = swatches.reduce((sum, s) => sum + s.share, 0);
  assert.ok(total > 0.95 && total <= 1.0001, `total share ${total}`);
});

test("palette is deterministic and handles empty images", () => {
  const { data, width, height } = fakeAvatar();
  assert.deepEqual(JSON.stringify(CADCore.palette(data, width, height)), JSON.stringify(CADCore.palette(data, width, height)));
  assert.deepEqual([...CADCore.palette(new Uint8ClampedArray(16), 2, 2)], []);
  const solid = new Uint8ClampedArray(4 * 4 * 4).fill(255);
  const one = CADCore.palette(solid, 4, 4);
  assert.equal(one.length, 1);
  assert.equal(one[0].hex, "#ffffff");
});

test("gradients", () => {
  assert.equal(CADCore.gradient([]), "");
  assert.equal(CADCore.gradient(["#112233"]), "#112233");
  assert.equal(CADCore.gradient(["#112233", "#445566"]), "linear-gradient(90deg, #112233, #445566)");
  assert.deepEqual([...CADCore.gradientStops("linear-gradient(90deg, #112233, #445566 50%, #abc)")], ["#112233", "#445566", "#aabbcc"]);
  assert.deepEqual([...CADCore.gradientStops("#112233")], []);
});

test("textOn", () => {
  assert.equal(CADCore.textOn([255, 255, 255]), "#000000");
  assert.equal(CADCore.textOn([10, 10, 40]), "#ffffff");
});
