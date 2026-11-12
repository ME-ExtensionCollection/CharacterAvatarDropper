// Mock Marinara host for the dev harness: window.__marinaraRunFullPageExtension
// with a fake `marinara` API, and a stand-in for the Colors tab
// (CardColors in packages/client/src/components/cards/CardColors.tsx) whose
// Extract button carries a fake React fiber, like React DOM attaches.
//
// The fiber on the button deliberately belongs to the stale half of the
// double buffer, so the extension has to find the current props through
// `alternate`, as it may have to in the real app.
//
// window.__cad: { calls, state, render(), setAvatar(url) } for the smoke test.
(() => {
  "use strict";

  const STORE_KEY = "cad-harness-storage";
  const cleanups = [];
  const readStore = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    } catch {
      return {};
    }
  };
  const storage = Object.freeze({
    async get() {
      return readStore();
    },
    async patch(value) {
      const next = { ...readStore(), ...value };
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
      return next;
    },
    async delete() {
      localStorage.removeItem(STORE_KEY);
    },
  });

  // ── The mock Colors tab ──

  const state = {
    variant: "character",
    name: "Alice",
    avatarUrl: "/dev/avatar.png",
    nameColor: "#f1c7a5",
    dialogueColor: "",
    boxColor: "",
  };
  const calls = [];

  // Fake fiber trees: HostRoot <- CardColors <- button, twice (current and stale).
  const fiberRoot = { current: null };
  const makeTree = () => {
    const root = { tag: 3, stateNode: fiberRoot, return: null };
    const component = { tag: 0, memoizedProps: null, return: root, alternate: null };
    const host = { tag: 5, memoizedProps: {}, return: component };
    return { root, component, host };
  };
  const trees = [makeTree(), makeTree()];
  trees[0].component.alternate = trees[1].component;
  trees[1].component.alternate = trees[0].component;
  let currentIndex = 0;

  const tab = document.getElementById("mock-tab");
  const container = document.createElement("div");
  container.className = "space-y-6";
  const header = document.createElement("p");
  header.textContent = "Character Colors";
  const extract = document.createElement("button");
  extract.type = "button";
  extract.className = "mari-editor-action mari-editor-action--accent mari-editor-action--primary flex w-full rounded-xl px-4 py-2.5 text-xs";
  const preview = document.createElement("div");
  preview.className = "mock-preview";
  const values = document.createElement("div");
  values.className = "mock-values";
  container.append(header, extract, preview, values);
  tab.append(container);

  function onColorChange(key, value) {
    calls.push([key, value]);
    state[key] = value;
    render();
  }

  function render() {
    extract.textContent = state.avatarUrl ? "Extract colors from avatar" : "Upload an avatar first";
    extract.disabled = !state.avatarUrl;
    const name = state.nameColor.includes("gradient(")
      ? `background:${state.nameColor};-webkit-background-clip:text;background-clip:text;color:transparent`
      : `color:${state.nameColor || "rgb(192,132,252)"}`;
    preview.innerHTML = `${state.avatarUrl ? `<img alt="" src="${state.avatarUrl}">` : "<span>?</span>"}
      <div><b style="${name}">${state.name}</b>
      <div class="mock-box" style="background:${state.boxColor ? `rgb(from ${state.boxColor} r g b / 0.8)` : "rgba(255,255,255,0.08)"}">
        They jump down. <strong style="color:${state.dialogueColor || "#fff"}">"Hello there."</strong></div></div>`;
    values.textContent = `nameColor     ${state.nameColor || "(none)"}\ndialogueColor ${state.dialogueColor || "(none)"}\nboxColor      ${state.boxColor || "(none)"}`;

    // Commit: the other tree becomes current with fresh props; the button keeps the stale one.
    const props = { variant: state.variant, header: null, name: state.name, avatarUrl: state.avatarUrl, avatarStyle: undefined, nameColor: state.nameColor, dialogueColor: state.dialogueColor, boxColor: state.boxColor, onColorChange };
    currentIndex = 1 - currentIndex;
    trees[currentIndex].component.memoizedProps = props;
    fiberRoot.current = trees[currentIndex].root;
    extract.__reactFiber$mock = trees[1 - currentIndex].host;
  }

  extract.addEventListener("click", () => alert("The built-in extract isn't mocked."));
  let objectUrl = null;
  const setAvatar = (url) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = url?.startsWith("blob:") ? url : null;
    state.avatarUrl = url;
    render();
  };
  document.getElementById("mock-file").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) setAvatar(URL.createObjectURL(file));
  });
  document.getElementById("mock-default").addEventListener("click", () => setAvatar("/dev/avatar.png"));
  document.getElementById("mock-external").addEventListener("click", () => {
    const other = location.hostname === "localhost" ? "127.0.0.1" : "localhost";
    setAvatar(`${location.protocol}//${other}:${location.port}/external/avatar.png`);
  });
  document.getElementById("mock-none").addEventListener("click", () => setAvatar(null));
  document.getElementById("mock-persona").addEventListener("click", () => {
    state.variant = state.variant === "character" ? "persona" : "character";
    state.name = state.variant === "character" ? "Alice" : "You";
    render();
  });
  render();

  window.__cad = { calls, state, render, setAvatar };

  // ── Host ──

  const marinara = Object.freeze({
    extension: { id: "dev-harness", name: "Char Avatar Dropper" },
    fetch: (input, init) => window.fetch(input, init),
    storage,
    log: Object.freeze({
      debug: (...args) => console.debug("[ext]", ...args),
      info: (...args) => console.info("[ext]", ...args),
      warn: (...args) => console.warn("[ext]", ...args),
      error: (...args) => console.error("[ext]", ...args),
    }),
    onCleanup(fn) {
      cleanups.push(fn);
    },
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  });

  window.__marinaraRunFullPageExtension = (extension, fn) => {
    Promise.resolve()
      .then(() => fn(marinara))
      .catch((error) => console.error("Extension failed", extension, error));
  };
  window.__cadCleanup = () => cleanups.splice(0).forEach((fn) => fn());
})();
