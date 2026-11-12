// Char Avatar Dropper: the "Pick colors from avatar" button in the Colors tab
// and the picker dialog.
//
// The Colors tab (CardColors in packages/client/src/components/cards/CardColors.tsx)
// has no data attributes. Its "Extract colors from avatar" button is the only
// `mari-editor-action--accent mari-editor-action--primary` button that sits
// inside a CardColors component, which CADBridge confirms through React.

const CADUi = (() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICONS = {
    // lucide pipette
    pipette: [
      ["path", { d: "m2 22 1-1h3l9-9" }],
      ["path", { d: "M3 21v-3l9-9" }],
      ["path", { d: "m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" }],
    ],
    // lucide copy
    copy: [
      ["rect", { width: 14, height: 14, x: 8, y: 8, rx: 2, ry: 2 }],
      ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }],
    ],
    // lucide x
    x: [
      ["path", { d: "M18 6 6 18" }],
      ["path", { d: "m6 6 12 12" }],
    ],
  };

  const SLOTS = Object.freeze([
    { key: "nameColor", label: "Name", hint: "Shift+click adds a gradient stop" },
    { key: "dialogueColor", label: "Dialogue" },
    { key: "boxColor", label: "Box", long: "Message box" },
  ]);
  const SAMPLE_SIZES = Object.freeze([
    { radius: 0, label: "1px" },
    { radius: 1, label: "3×3" },
    { radius: 2, label: "5×5" },
  ]);
  const MAX_SOURCE = 4096; // larger avatars are scaled down before sampling
  const MAX_ZOOM = 64;
  const LOUPE_CELLS = 15;
  const LOUPE_CELL = 8;

  function icon(name, size = "0.875rem") {
    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
    for (const [tag, attrs] of ICONS[name]) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      svg.append(node);
    }
    return svg;
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "style") Object.assign(node.style, value);
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (key in node && typeof value !== "string") node[key] = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  }

  // ── Toasts ──

  let toastRoot = null;
  function toast(message, { error = false, duration = 5000 } = {}) {
    if (!toastRoot?.isConnected) {
      toastRoot = el("div", { class: "cad-toasts", "aria-live": "polite" });
      document.body.append(toastRoot);
    }
    const node = el("div", { class: `cad-toast${error ? " cad-toast--error" : ""}`, role: error ? "alert" : "status" },
      el("div", { class: "cad-toast__text", text: message }),
      el("button", { type: "button", class: "cad-btn cad-btn--ghost cad-btn--icon", "aria-label": "Dismiss", onclick: () => node.remove() }, icon("x", "0.75rem")),
    );
    toastRoot.append(node);
    marinara.setTimeout(() => node.remove(), duration);
  }

  // ── Settings (best effort; the dialog works without storage) ──

  async function loadSettings() {
    try {
      const stored = (await marinara.storage.get()) ?? {};
      return { sampleRadius: SAMPLE_SIZES.some((s) => s.radius === stored.sampleRadius) ? stored.sampleRadius : 1 };
    } catch {
      return { sampleRadius: 1 };
    }
  }
  const saveSettings = (patch) => Promise.resolve().then(() => marinara.storage.patch(patch)).catch(() => {});

  // ── Loading the avatar's pixels ──

  function loadImage(src, crossOrigin) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("The avatar image didn't load."));
      img.src = src;
    });
  }

  function readPixels(img) {
    let width = img.naturalWidth;
    let height = img.naturalHeight;
    if (!width || !height) throw new Error("The avatar image is empty.");
    const shrink = Math.min(1, MAX_SOURCE / Math.max(width, height));
    width = Math.max(1, Math.round(width * shrink));
    height = Math.max(1, Math.round(height * shrink));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas isn't available in this browser.");
    ctx.drawImage(img, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height); // throws SecurityError on a tainted canvas
    return { canvas, data, width, height };
  }

  const isCrossOrigin = (url) => {
    try {
      const parsed = new URL(url, location.href);
      return /^https?:$/.test(parsed.protocol) && parsed.origin !== location.origin;
    } catch {
      return false;
    }
  };

  async function loadPixels(url) {
    try {
      return readPixels(await loadImage(url, isCrossOrigin(url)));
    } catch (first) {
      if (/^(data|blob):/.test(url)) throw first;
      // Cross-origin without CORS, or an image that needs Marinara's fetch: read it as a blob.
      let response;
      try {
        response = await marinara.fetch(url);
      } catch {
        if (isCrossOrigin(url)) throw new Error("The avatar is on another site that doesn't let page code read it (no CORS).");
        throw first;
      }
      if (!response.ok) throw new Error(`The avatar couldn't be loaded (HTTP ${response.status}).`);
      const objectUrl = URL.createObjectURL(await response.blob());
      try {
        return readPixels(await loadImage(objectUrl, false));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }

  // ── The picker dialog ──

  let openDialog = null; // { close(keep) }

  const isColorText = (value) => !value || /^linear-gradient\(/i.test(value) || (typeof CSS !== "undefined" ? CSS.supports("color", value) : !!CADCore.parseHex(value));

  async function openPicker(anchor) {
    if (openDialog) return;
    const colors = CADBridge.readColors(anchor);
    if (!colors) return toast("Char Avatar Dropper couldn't reach the Colors tab. Reopen it and try again.", { error: true });
    if (!colors.avatarUrl) return toast("Upload an avatar first.", { error: true });

    const settings = await loadSettings();
    let image;
    try {
      image = await loadPixels(colors.avatarUrl);
    } catch (error) {
      marinara.log.warn("Char Avatar Dropper could not read the avatar", error);
      return toast(error?.name === "SecurityError" ? "The browser won't let page code read this avatar's pixels (it's on another site without CORS)." : error.message || "The avatar couldn't be loaded.", { error: true });
    }
    if (!anchor.isConnected) return;

    const original = { nameColor: colors.nameColor, dialogueColor: colors.dialogueColor, boxColor: colors.boxColor };
    const state = {
      values: { ...original },
      active: "nameColor",
      radius: settings.sampleRadius,
      nameStops: initialStops(original.nameColor),
      view: { scale: 1, ox: 0, oy: 0, fit: 1 },
      hover: null, // { x, y, rgb, cx, cy }
      drag: null,
    };
    const swatches = CADCore.palette(image.data, image.width, image.height);

    // ── DOM ──

    const canvas = el("canvas", { class: "cad-canvas" });
    const loupe = el("canvas", { class: "cad-loupe", width: LOUPE_CELLS * LOUPE_CELL * devicePixelRatio, height: LOUPE_CELLS * LOUPE_CELL * devicePixelRatio, hidden: true });
    const zoomLabel = el("span", { class: "cad-zoom__label" });
    const stage = el("div", { class: "cad-stage", tabindex: "-1" },
      canvas,
      loupe,
      el("div", { class: "cad-zoom" },
        el("button", { type: "button", class: "cad-btn cad-btn--small", title: "Zoom out (-)", text: "−", onclick: () => zoomBy(1 / 1.5) }),
        zoomLabel,
        el("button", { type: "button", class: "cad-btn cad-btn--small", title: "Zoom in (+)", text: "+", onclick: () => zoomBy(1.5) }),
        el("button", { type: "button", class: "cad-btn cad-btn--small", title: "Fit (0)", text: "Fit", onclick: () => fit() }),
      ),
    );

    const readSwatch = el("span", { class: "cad-readout__swatch" });
    const readHex = el("span", { class: "cad-readout__hex", text: "Hover the image" });
    const sizeButtons = SAMPLE_SIZES.map((size) =>
      el("button", {
        type: "button",
        class: "cad-seg__btn",
        text: size.label,
        title: size.radius ? `Average a ${size.label} square` : "Exact pixel",
        onclick: () => {
          state.radius = size.radius;
          void saveSettings({ sampleRadius: size.radius });
          renderSizes();
          if (state.hover) hoverAt(state.hover.cx, state.hover.cy);
        },
      }),
    );
    const readout = el("div", { class: "cad-readout" },
      readSwatch,
      readHex,
      el("div", { class: "cad-seg", role: "group", "aria-label": "Sample size" }, sizeButtons),
    );

    const slotNodes = new Map();
    const slotList = el("div", { class: "cad-slots", role: "radiogroup", "aria-label": "Color to set" },
      SLOTS.map((slot, index) => {
        const swatch = el("span", { class: "cad-slot__swatch" });
        const input = el("input", {
          class: "cad-input",
          spellcheck: false,
          autocomplete: "off",
          "aria-label": `${slot.long ?? slot.label} color`,
          placeholder: "Not set",
          onfocus: () => setActive(slot.key),
          onchange: () => {
            const value = input.value.trim();
            if (!isColorText(value)) {
              toast(`"${value}" isn't a color.`, { error: true });
              input.value = state.values[slot.key];
              return;
            }
            if (slot.key === "nameColor") state.nameStops = initialStops(value);
            apply(slot.key, value);
          },
          onkeydown: (event) => event.key === "Enter" && input.blur(),
        });
        const pick = el("button", {
          type: "button",
          class: "cad-slot__pick",
          role: "radio",
          title: `Clicks on the image set the ${(slot.long ?? slot.label).toLowerCase()} color (${index + 1})`,
          onclick: () => setActive(slot.key),
        }, el("span", { class: "cad-slot__num", text: String(index + 1) }), swatch, el("span", { class: "cad-slot__label", text: slot.label }));
        const copy = el("button", {
          type: "button",
          class: "cad-btn cad-btn--ghost cad-btn--icon",
          title: "Copy",
          "aria-label": `Copy ${(slot.long ?? slot.label).toLowerCase()} color`,
          onclick: () => {
            const value = state.values[slot.key];
            if (!value) return;
            navigator.clipboard?.writeText(value).then(() => toast(`Copied ${value}`), () => toast("Copy failed.", { error: true }));
          },
        }, icon("copy", "0.75rem"));
        const stops = slot.key === "nameColor" ? el("div", { class: "cad-stops" }) : null;
        const row = el("div", { class: "cad-slot", "data-key": slot.key },
          el("div", { class: "cad-slot__row" }, pick, input, copy),
          stops,
          slot.hint ? el("div", { class: "cad-muted cad-slot__hint", text: slot.hint }) : null,
        );
        slotNodes.set(slot.key, { row, pick, swatch, input, stops });
        return row;
      }),
    );

    const suggest = el("div", { class: "cad-suggest" },
      el("div", { class: "cad-section-title", text: "Suggested from the image" }),
      swatches.length
        ? el("div", { class: "cad-swatches" },
          swatches.map((swatch) => {
            const kindNote = swatch.kind === "color" ? "" : ` · probably ${swatch.kind === "skin" ? "skin" : "grey/black/white"}`;
            return el("button", {
              type: "button",
              class: `cad-swatch cad-swatch--${swatch.kind}`,
              style: { backgroundColor: swatch.hex, color: CADCore.textOn(swatch.rgb) },
              title: `${swatch.hex} · ${(swatch.share * 100).toFixed(1)}% of the image${kindNote}`,
              "aria-label": `${swatch.hex}${kindNote}`,
              onclick: (event) => pickColor(swatch.rgb, event.shiftKey),
            }, swatch.kind === "skin" ? el("span", { class: "cad-swatch__tag", text: "skin?" }) : null);
          }))
        : el("p", { class: "cad-muted", text: "No opaque pixels to suggest from." }),
      el("p", { class: "cad-muted", text: "Faded swatches look like skin or neutrals and are listed last." }),
    );

    const title = `Pick colors${colors.name ? ` — ${colors.name}` : ""}`;
    const done = el("button", { type: "button", class: "cad-btn cad-btn--primary", text: "Done", onclick: () => close(true) });
    const dialog = el("div", { class: "cad-dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
      el("div", { class: "cad-dialog__head" },
        el("h2", { class: "cad-dialog__title", text: title }),
        el("button", { type: "button", class: "cad-btn cad-btn--ghost cad-btn--icon", "aria-label": "Cancel", title: "Cancel (Esc)", onclick: () => close(false) }, icon("x")),
      ),
      el("div", { class: "cad-dialog__body" }, stage, el("div", { class: "cad-side" }, readout, slotList, suggest)),
      el("div", { class: "cad-dialog__foot" },
        el("p", { class: "cad-muted cad-hint", text: "Click: set the selected color · Wheel: zoom · Drag: pan · 1/2/3: choose color · Esc: cancel" }),
        el("div", { class: "cad-dialog__buttons" },
          el("button", { type: "button", class: "cad-btn", text: "Cancel", title: "Put the colors back as they were", onclick: () => close(false) }),
          done,
        ),
      ),
    );
    const overlay = el("div", { class: "cad-overlay" }, dialog);

    // ── Colors ──

    function initialStops(value) {
      const stops = CADCore.gradientStops(value);
      if (stops.length) return stops;
      const rgb = CADCore.parseHex(value);
      return rgb ? [CADCore.toHex(rgb)] : [];
    }

    function apply(key, value) {
      state.values[key] = value;
      if (!CADBridge.setColor(anchor, key, value)) {
        toast("The Colors tab closed, so the color couldn't be set.", { error: true });
        close(true);
        return;
      }
      renderSlots();
    }

    function pickColor(rgb, shift) {
      const hex = CADCore.toHex(rgb);
      const key = state.active;
      if (key !== "nameColor") return apply(key, hex);
      state.nameStops = shift ? [...state.nameStops, hex] : [hex];
      apply(key, CADCore.gradient(state.nameStops));
    }

    function setActive(key) {
      state.active = key;
      renderSlots();
    }

    function paintSwatch(node, value) {
      node.classList.toggle("cad-empty", !value);
      node.style.background = value || "";
    }

    function renderSlots() {
      for (const slot of SLOTS) {
        const { row, pick, swatch, input, stops } = slotNodes.get(slot.key);
        const value = state.values[slot.key];
        const on = state.active === slot.key;
        row.classList.toggle("cad-slot--active", on);
        pick.setAttribute("aria-checked", String(on));
        paintSwatch(swatch, value);
        if (document.activeElement !== input) input.value = value;
        if (stops) {
          const gradient = state.nameStops.length > 1 && value === CADCore.gradient(state.nameStops);
          stops.replaceChildren(...(gradient
            ? state.nameStops.map((stop, index) =>
              el("span", { class: "cad-stop", style: { backgroundColor: stop, color: CADCore.textOn(CADCore.parseHex(stop)) } },
                stop,
                el("button", {
                  type: "button",
                  class: "cad-stop__x",
                  "aria-label": `Remove stop ${stop}`,
                  onclick: () => {
                    state.nameStops = state.nameStops.filter((_, i) => i !== index);
                    apply("nameColor", CADCore.gradient(state.nameStops));
                  },
                }, icon("x", "0.625rem")),
              ))
            : []));
        }
      }
    }

    function renderSizes() {
      SAMPLE_SIZES.forEach((size, i) => sizeButtons[i].setAttribute("aria-pressed", String(size.radius === state.radius)));
    }

    // ── Canvas view ──

    const ctx = canvas.getContext("2d");
    const loupeCtx = loupe.getContext("2d");
    let frame = 0;
    const redraw = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), draw()));
    };

    function stageSize() {
      return { w: stage.clientWidth || 1, h: stage.clientHeight || 1 };
    }

    function draw() {
      const { w, h } = stageSize();
      const dpr = devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const { scale, ox, oy } = state.view;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = scale < 2;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image.canvas, ox, oy, image.width * scale, image.height * scale);
      if (state.hover && scale >= 4) {
        const r = state.radius;
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeRect(ox + (state.hover.x - r) * scale - 0.5, oy + (state.hover.y - r) * scale - 0.5, (2 * r + 1) * scale + 1, (2 * r + 1) * scale + 1);
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.strokeRect(ox + (state.hover.x - r) * scale + 0.5, oy + (state.hover.y - r) * scale + 0.5, (2 * r + 1) * scale - 1, (2 * r + 1) * scale - 1);
      }
      zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    }

    function fit() {
      const { w, h } = stageSize();
      const scale = Math.min(w / image.width, h / image.height) * 0.96;
      state.view = { scale, fit: scale, ox: (w - image.width * scale) / 2, oy: (h - image.height * scale) / 2 };
      redraw();
    }

    function zoomAt(factor, cx, cy) {
      const { scale, ox, oy, fit: fitScale } = state.view;
      const next = Math.min(MAX_ZOOM, Math.max(Math.min(fitScale * 0.5, 1), scale * factor));
      const k = next / scale;
      state.view = { ...state.view, scale: next, ox: cx - (cx - ox) * k, oy: cy - (cy - oy) * k };
      redraw();
    }
    const zoomBy = (factor) => {
      const { w, h } = stageSize();
      zoomAt(factor, w / 2, h / 2);
    };

    const local = (event) => {
      const rect = stage.getBoundingClientRect();
      return { cx: event.clientX - rect.left, cy: event.clientY - rect.top };
    };
    const toImage = (cx, cy) => ({ x: Math.floor((cx - state.view.ox) / state.view.scale), y: Math.floor((cy - state.view.oy) / state.view.scale) });

    function hoverAt(cx, cy) {
      const { x, y } = toImage(cx, cy);
      const rgb = CADCore.averageAt(image.data, image.width, image.height, x, y, state.radius);
      state.hover = rgb ? { x, y, rgb, cx, cy } : null;
      if (rgb) {
        const hex = CADCore.toHex(rgb);
        readSwatch.style.background = hex;
        readSwatch.classList.remove("cad-empty");
        readHex.textContent = hex;
      } else {
        readSwatch.classList.add("cad-empty");
        readSwatch.style.background = "";
        readHex.textContent = x >= 0 && y >= 0 && x < image.width && y < image.height ? "Transparent" : "Hover the image";
      }
      drawLoupe(x, y, cx, cy, !!rgb);
      redraw();
    }

    function drawLoupe(x, y, cx, cy, show) {
      loupe.hidden = !show;
      if (!show) return;
      const dpr = devicePixelRatio || 1;
      const size = LOUPE_CELLS * LOUPE_CELL;
      const half = Math.floor(LOUPE_CELLS / 2);
      loupeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      loupeCtx.fillStyle = "#111";
      loupeCtx.fillRect(0, 0, size, size);
      loupeCtx.imageSmoothingEnabled = false;
      const sx = x - half;
      const sy = y - half;
      // Only the part inside the image, so edges don't stretch.
      const x0 = Math.max(0, sx);
      const y0 = Math.max(0, sy);
      const x1 = Math.min(image.width, sx + LOUPE_CELLS);
      const y1 = Math.min(image.height, sy + LOUPE_CELLS);
      if (x1 > x0 && y1 > y0) loupeCtx.drawImage(image.canvas, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * LOUPE_CELL, (y0 - sy) * LOUPE_CELL, (x1 - x0) * LOUPE_CELL, (y1 - y0) * LOUPE_CELL);
      loupeCtx.strokeStyle = "rgba(0,0,0,0.25)";
      loupeCtx.lineWidth = 1;
      loupeCtx.beginPath();
      for (let i = 1; i < LOUPE_CELLS; i += 1) {
        loupeCtx.moveTo(i * LOUPE_CELL + 0.5, 0);
        loupeCtx.lineTo(i * LOUPE_CELL + 0.5, size);
        loupeCtx.moveTo(0, i * LOUPE_CELL + 0.5);
        loupeCtx.lineTo(size, i * LOUPE_CELL + 0.5);
      }
      loupeCtx.stroke();
      const r = state.radius;
      const at = (half - r) * LOUPE_CELL;
      const span = (2 * r + 1) * LOUPE_CELL;
      loupeCtx.strokeStyle = "#000";
      loupeCtx.strokeRect(at - 0.5, at - 0.5, span + 1, span + 1);
      loupeCtx.strokeStyle = "#fff";
      loupeCtx.strokeRect(at + 0.5, at + 0.5, span - 1, span - 1);
      // Keep it inside the stage, away from the cursor.
      const { w, h } = stageSize();
      const gap = 20;
      const left = cx + gap + size > w ? cx - gap - size : cx + gap;
      const top = cy + gap + size > h ? cy - gap - size : cy + gap;
      loupe.style.left = `${Math.max(4, left)}px`;
      loupe.style.top = `${Math.max(4, top)}px`;
    }

    stage.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target !== canvas) return;
      const { cx, cy } = local(event);
      state.drag = { id: event.pointerId, cx, cy, ox: state.view.ox, oy: state.view.oy, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    stage.addEventListener("pointermove", (event) => {
      const { cx, cy } = local(event);
      const drag = state.drag;
      if (drag && drag.id === event.pointerId) {
        if (!drag.moved && Math.hypot(cx - drag.cx, cy - drag.cy) > 4) {
          drag.moved = true;
          stage.classList.add("cad-stage--panning");
        }
        if (drag.moved) {
          state.view = { ...state.view, ox: drag.ox + cx - drag.cx, oy: drag.oy + cy - drag.cy };
          loupe.hidden = true;
          redraw();
          return;
        }
      }
      hoverAt(cx, cy);
    });
    const endDrag = (event, pick) => {
      const drag = state.drag;
      if (!drag || drag.id !== event.pointerId) return;
      state.drag = null;
      stage.classList.remove("cad-stage--panning");
      if (pick && !drag.moved) {
        const { cx, cy } = local(event);
        hoverAt(cx, cy);
        if (state.hover) pickColor(state.hover.rgb, event.shiftKey);
      }
    };
    stage.addEventListener("pointerup", (event) => endDrag(event, true));
    stage.addEventListener("pointercancel", (event) => endDrag(event, false));
    stage.addEventListener("pointerleave", () => {
      if (state.drag) return;
      state.hover = null;
      loupe.hidden = true;
      redraw();
    });
    stage.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const { cx, cy } = local(event);
        zoomAt(Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015)), cx, cy);
        if (state.hover) hoverAt(cx, cy);
      },
      { passive: false },
    );
    const resize = new ResizeObserver(() => {
      const { fit: fitScale, scale } = state.view;
      if (Math.abs(scale - fitScale) < 1e-6) fit();
      else redraw();
    });

    // ── Keys ──

    const inField = (target) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (inField(event.target)) event.target.blur();
        else close(false);
        return;
      }
      if (!overlay.contains(event.target) && event.target !== document.body) return;
      // Keep Marinara's own shortcuts out of the dialog.
      event.stopImmediatePropagation();
      if (inField(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const index = ["1", "2", "3"].indexOf(event.key);
      if (index >= 0) setActive(SLOTS[index].key);
      else if (event.key === "+" || event.key === "=") zoomBy(1.5);
      else if (event.key === "-") zoomBy(1 / 1.5);
      else if (event.key === "0") fit();
      else return;
      event.preventDefault();
    }

    // ── Open / close ──

    function close(keep) {
      if (openDialog !== handle) return;
      openDialog = null;
      window.removeEventListener("keydown", onKey, true);
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
      overlay.remove();
      if (!keep) {
        for (const key of CADBridge.COLOR_KEYS) {
          if (state.values[key] !== original[key]) CADBridge.setColor(anchor, key, original[key]);
        }
      }
      if (anchor.isConnected) anchor.focus?.();
    }

    const handle = { close };
    openDialog = handle;
    window.addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    renderSlots();
    renderSizes();
    fit();
    resize.observe(stage);
    stage.focus({ preventScroll: true });
  }

  // ── The button in the Colors tab ──

  function findAnchors() {
    const out = [];
    for (const button of document.querySelectorAll("button.mari-editor-action--accent.mari-editor-action--primary")) {
      if (button.closest(".cad-overlay")) continue;
      const colors = CADBridge.readColors(button);
      if (colors) out.push({ button, colors });
    }
    return out;
  }

  function decorate() {
    for (const { button, colors } of findAnchors()) {
      let ours = button.nextElementSibling?.classList.contains("cad-open") ? button.nextElementSibling : null;
      if (!ours) {
        ours = el("button", {
          type: "button",
          class: "mari-editor-action flex w-full rounded-xl px-4 py-2.5 text-xs cad-open",
          onclick: () => void openPicker(button),
        }, icon("pipette"), el("span", { text: "Pick colors from avatar" }));
        button.after(ours);
      }
      const disabled = !colors.avatarUrl;
      if (ours.disabled !== disabled) ours.disabled = disabled;
      const tip = disabled ? "Upload an avatar first" : "Open the avatar and pick the name, dialogue and message box colors from it";
      if (ours.title !== tip) ours.title = tip;
    }
  }

  let frame = 0;
  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(() => ((frame = 0), decorate()));
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  decorate();

  marinara.onCleanup(() => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    openDialog?.close(true);
    for (const node of document.querySelectorAll(".cad-open, .cad-toasts, .cad-overlay")) node.remove();
  });

  return Object.freeze({ openPicker, decorate, toast });
})();
