// Char Avatar Dropper: reaches the Colors tab's CardColors component.
//
// CardColors (packages/client/src/components/cards/CardColors.tsx) is used by
// both the character and the persona editor. Its props carry what we need:
//   variant: "character" | "persona", avatarUrl, nameColor, dialogueColor,
//   boxColor, onColorChange(key, value)
// onColorChange is the same callback the built-in "Extract colors from avatar"
// button uses, so writing through it updates the form, marks the editor dirty
// and refreshes the preview; the user saves as usual.
//
// Marinara doesn't publish these, so we walk React's fiber from a DOM node
// that CardColors renders (its Extract button) up to the component.

const CADBridge = (() => {
  "use strict";

  const COLOR_KEYS = Object.freeze(["nameColor", "dialogueColor", "boxColor"]);

  function fiberOf(node) {
    if (!node) return null;
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    return key ? node[key] : null;
  }

  const isCardColorsProps = (props) =>
    !!props &&
    typeof props.onColorChange === "function" &&
    (props.variant === "character" || props.variant === "persona") &&
    "nameColor" in props &&
    "avatarUrl" in props;

  // A DOM node keeps the fiber it was created with, which can be the stale
  // half of React's double buffer. The current half's return chain ends at the
  // HostRoot that its FiberRoot points to.
  function isCurrent(fiber) {
    let node = fiber;
    let guard = 0;
    while (node.return && guard < 10000) (node = node.return), (guard += 1);
    return node.tag === 3 && node.stateNode?.current === node;
  }

  function componentFiber(node) {
    let fiber = fiberOf(node);
    for (let depth = 0; fiber && depth < 25; depth += 1, fiber = fiber.return) {
      const halves = [fiber, fiber.alternate].filter((half) => half && isCardColorsProps(half.memoizedProps));
      if (!halves.length) continue;
      return halves.find(isCurrent) ?? halves[0];
    }
    return null;
  }

  /** CardColors props as of the last render, or null if `node` isn't inside one. */
  function cardProps(node) {
    try {
      return componentFiber(node)?.memoizedProps ?? null;
    } catch (error) {
      marinara.log.debug("Char Avatar Dropper could not inspect Marinara's component tree", error);
      return null;
    }
  }

  /** { variant, name, avatarUrl, nameColor, dialogueColor, boxColor } or null. */
  function readColors(node) {
    const props = cardProps(node);
    if (!props) return null;
    return {
      variant: props.variant,
      name: typeof props.name === "string" ? props.name : "",
      avatarUrl: typeof props.avatarUrl === "string" && props.avatarUrl ? props.avatarUrl : null,
      nameColor: String(props.nameColor ?? ""),
      dialogueColor: String(props.dialogueColor ?? ""),
      boxColor: String(props.boxColor ?? ""),
    };
  }

  /** Write one color through CardColors. False if the component is gone. */
  function setColor(node, key, value) {
    if (!COLOR_KEYS.includes(key)) throw new Error(`Unknown color key: ${key}`);
    const props = node?.isConnected ? cardProps(node) : null;
    if (!props) return false;
    props.onColorChange(key, value);
    return true;
  }

  return Object.freeze({ COLOR_KEYS, cardProps, readColors, setColor });
})();
