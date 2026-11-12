// Browser smoke test: the dev harness (mock Marinara Colors tab) in headless
// Chrome. No real Marinara is involved.
//
//   CAD_PLAYWRIGHT=/path/to/node_modules/playwright-core   (default: import "playwright-core")
//   CAD_CHROME=/usr/bin/google-chrome-stable              (default: Playwright's own browser)
//   CAD_SHOTS=/some/dir                                   (optional screenshots)
// Usage: node scripts/smoke.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "./serve.mjs";
import { PARTS } from "../dev/fake-avatar.mjs";

const pw = await import(process.env.CAD_PLAYWRIGHT ? pathToFileURL(join(process.env.CAD_PLAYWRIGHT, "index.mjs")).href : "playwright-core");
const shots = process.env.CAD_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const hex = (rgb) => `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
const HAIR = hex(PARTS.hair);
const EYES = hex(PARTS.eyes);
const OUTFIT = hex(PARTS.outfit);
const SCALE = 4; // serve.mjs serves fakeAvatar(4): 480×480
const SIZE = 120 * SCALE;

const { server, port } = await serve(0);
const BASE = `http://localhost:${port}`;
const browser = await pw.chromium.launch({ executablePath: process.env.CAD_CHROME || undefined, headless: true });
let failed = false;

async function scenario(name, fn) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => msg.type() === "error" && !/Failed to load resource|CORS/.test(msg.text()) && errors.push(msg.text()));
  try {
    await page.goto(`${BASE}/dev/harness.html`);
    await page.evaluate(() => localStorage.clear());
    await page.waitForSelector(".cad-open");
    await fn(page, async (label) => shots && page.screenshot({ path: join(shots, `${name}-${label}.png`) }));
    assert.deepEqual(errors, [], "no page errors");
    console.log(`ok   ${name}`);
  } catch (error) {
    failed = true;
    console.log(`FAIL ${name}\n     ${error.stack ?? error}`);
    if (shots) await page.screenshot({ path: join(shots, `${name}-failure.png`) }).catch(() => {});
  } finally {
    await page.close();
  }
}

const state = (page) => page.evaluate(() => ({ ...window.__cad.state }));

/** Click the avatar pixel (x, y) of the 120×120 layout, assuming the dialog is at "Fit". */
async function clickPixel(page, x, y, modifiers = []) {
  const box = await page.locator(".cad-canvas").boundingBox();
  const scale = Math.min(box.width / SIZE, box.height / SIZE) * 0.96;
  const ox = (box.width - SIZE * scale) / 2;
  const oy = (box.height - SIZE * scale) / 2;
  const at = { x: box.x + ox + (x * SCALE + SCALE / 2) * scale, y: box.y + oy + (y * SCALE + SCALE / 2) * scale };
  await page.mouse.move(at.x, at.y);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.down();
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
}

async function openDialog(page) {
  await page.click(".cad-open");
  await page.waitForSelector(".cad-dialog");
  await page.waitForFunction(() => document.querySelector(".cad-zoom__label")?.textContent?.endsWith("%"));
}

await scenario("button", async (page, shot) => {
  const button = page.locator(".cad-open");
  assert.equal(await button.isDisabled(), false);
  // Right after the Extract button, inside the same container.
  assert.equal(await page.evaluate(() => document.querySelector(".mari-editor-action--primary").nextElementSibling.classList.contains("cad-open")), true);
  await shot("tab");
  await page.evaluate(() => window.__cad.setAvatar(null));
  await page.waitForFunction(() => document.querySelector(".cad-open").disabled);
  await page.evaluate(() => window.__cad.setAvatar("/dev/avatar.png"));
  await page.waitForFunction(() => !document.querySelector(".cad-open").disabled);
  // Only one button, however often the tab re-renders.
  await page.evaluate(() => {
    for (let i = 0; i < 5; i += 1) window.__cad.render();
  });
  await page.waitForTimeout(50);
  assert.equal(await page.locator(".cad-open").count(), 1);
});

await scenario("swatches", async (page, shot) => {
  await openDialog(page);
  const swatches = await page.$$eval(".cad-swatch", (nodes) => nodes.map((n) => ({ label: n.getAttribute("aria-label"), cls: n.className })));
  const index = (h) => swatches.findIndex((s) => s.label.startsWith(h));
  const skin = swatches.findIndex((s) => s.cls.includes("cad-swatch--skin"));
  assert.ok(skin >= 0, "a skin swatch is listed");
  for (const h of [HAIR, OUTFIT, EYES]) assert.ok(index(h) >= 0 && index(h) < skin, `${h} before skin`);
  await shot("dialog");
  // Clicking a swatch sets the active color (Name).
  await page.locator(".cad-swatch").first().click();
  assert.equal((await state(page)).nameColor, swatches[0].label.slice(0, 7));
});

await scenario("eyedrop", async (page, shot) => {
  await openDialog(page);
  await clickPixel(page, 60, 15); // hair
  assert.equal((await state(page)).nameColor, HAIR);
  await page.keyboard.press("2");
  await clickPixel(page, 45, 50); // left eye
  assert.equal((await state(page)).dialogueColor, EYES);
  await page.keyboard.press("3");
  await clickPixel(page, 60, 110); // outfit
  assert.equal((await state(page)).boxColor, OUTFIT);
  // Shift+click on Name adds a gradient stop.
  await page.keyboard.press("1");
  await clickPixel(page, 60, 110, ["Shift"]);
  assert.equal((await state(page)).nameColor, `linear-gradient(90deg, ${HAIR}, ${OUTFIT})`);
  assert.equal(await page.locator(".cad-stop").count(), 2);
  // The loupe shows while hovering the image.
  assert.equal(await page.locator(".cad-loupe").isVisible(), true);
  await shot("picked");
  // Removing a stop goes back to a solid color.
  await page.locator(".cad-stop__x").last().click();
  assert.equal((await state(page)).nameColor, HAIR);
  await page.click(".cad-btn--primary"); // Done
  assert.equal(await page.locator(".cad-overlay").count(), 0);
  assert.deepEqual(await state(page), { ...(await state(page)), nameColor: HAIR, dialogueColor: EYES, boxColor: OUTFIT });
});

await scenario("cancel restores", async (page) => {
  const before = await state(page);
  await openDialog(page);
  await clickPixel(page, 60, 15);
  await page.keyboard.press("3");
  await clickPixel(page, 60, 110);
  assert.equal((await state(page)).boxColor, OUTFIT);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".cad-overlay").count(), 0);
  const after = await state(page);
  assert.equal(after.nameColor, before.nameColor);
  assert.equal(after.boxColor, before.boxColor);
});

await scenario("hex input, sample size, zoom", async (page) => {
  await openDialog(page);
  const input = page.locator('.cad-slot[data-key="dialogueColor"] .cad-input');
  await input.fill("#123456");
  await input.press("Enter");
  assert.equal((await state(page)).dialogueColor, "#123456");
  await input.fill("not a color");
  await input.press("Enter");
  assert.equal((await state(page)).dialogueColor, "#123456");
  await page.waitForSelector(".cad-toast--error");
  // Sample size is remembered.
  await page.locator(".cad-seg__btn", { hasText: "5×5" }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("cad-harness-storage")).sampleRadius), 2);
  // Wheel zoom.
  const fitLabel = await page.locator(".cad-zoom__label").textContent();
  const box = await page.locator(".cad-canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -600);
  await page.waitForFunction((label) => document.querySelector(".cad-zoom__label").textContent !== label, fitLabel);
  assert.ok(parseInt(await page.locator(".cad-zoom__label").textContent(), 10) > parseInt(fitLabel, 10));
  // Marinara's own key handlers don't see keys typed in the dialog.
  const seen = await page.evaluate(() => {
    let count = 0;
    document.addEventListener("keydown", () => (count += 1));
    document.querySelector(".cad-stage").dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    return count;
  });
  assert.equal(seen, 0);
  await page.click(".cad-btn--primary");
});

await scenario("persona and file avatar", async (page) => {
  await page.click("#mock-persona");
  await openDialog(page);
  await clickPixel(page, 60, 15);
  assert.equal((await state(page)).nameColor, HAIR);
  assert.equal((await state(page)).variant, "persona");
  await page.click(".cad-btn--primary");
  // A blob: avatar (an unsaved upload in the editor).
  await page.evaluate(async () => {
    const blob = await (await fetch("/dev/avatar.png")).blob();
    window.__cad.setAvatar(URL.createObjectURL(blob));
  });
  await openDialog(page);
  await page.keyboard.press("2");
  await clickPixel(page, 75, 50);
  assert.equal((await state(page)).dialogueColor, EYES);
  await page.keyboard.press("Escape");
});

await scenario("other-site avatar without CORS", async (page, shot) => {
  await page.click("#mock-external");
  await page.click(".cad-open");
  await page.waitForSelector(".cad-toast--error");
  assert.match(await page.locator(".cad-toast--error").textContent(), /another site/);
  assert.equal(await page.locator(".cad-overlay").count(), 0);
  await shot("cors-error");
});

await scenario("cleanup", async (page) => {
  await openDialog(page);
  await page.evaluate(() => window.__cadCleanup());
  assert.equal(await page.locator(".cad-open, .cad-overlay").count(), 0);
});

await browser.close();
server.close();
if (failed) process.exit(1);
console.log("smoke: all passed");
