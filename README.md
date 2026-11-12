# Char Avatar Dropper

A Marinara Engine External Extension that lets you eyedrop a character's (or persona's) **name**, **dialogue** and **message box** colors from their avatar.

Marinara's **Extract colors from avatar** takes the three biggest color groups in a small copy of the avatar. In most portraits the biggest group is skin, so you get beige or peach. Char Avatar Dropper opens the avatar large, so you can click the hair, eyes or outfit instead.

## How it works

1. Open a character (or persona) and go to the **Colors** tab. Under **Extract colors from avatar** there's a new **Pick colors from avatar** button.
2. The avatar opens large. Move over it to see a magnified loupe and the color under the cursor.
3. Choose which color to set on the right: **1 Name**, **2 Dialogue**, **3 Box** (click it or press 1, 2 or 3). Then click the image. The editor's color and preview update right away.
4. **Done** keeps the colors. **Cancel** or Esc puts back the colors you had when you opened it.
5. Save the character as usual. Char Avatar Dropper only fills the editor's color fields; nothing is saved until you save.

More:

- **Wheel** zooms at the cursor, **drag** pans, **Fit** (or 0) resets. **+** and **-** zoom too.
- **1px / 3×3 / 5×5** sets how many pixels are averaged per click. 3×3 is the default and smooths out JPEG noise and anti-aliased edges. The choice is remembered.
- **Shift+click** with Name selected adds a gradient stop, so two clicks give `linear-gradient(90deg, hair, eyes)`. Remove a stop with its ×.
- Type any hex or CSS color into a field to set it directly. The copy button copies it.
- **Suggested from the image** lists the image's main colors with distinct, saturated colors first. Swatches that look like skin or grey/black/white are faded and listed last. Click one to set the selected color. The skin guess is rough (light brown hair can count as skin), so nothing is hidden.

## Install

1. Skip this step if your other External Extensions already run. Otherwise, set `ENABLE_EXTERNAL_EXTENSIONS=true` in the Marinara host's `.env`, restart Marinara when convenient, and turn on **Settings > Advanced > Danger Zone > Allow third-party extension imports**.
2. **Settings > Addons > External Extensions > Import Extension Folder**. Pick the **`extension`** folder in this repository, not the repository root.
3. Open the draft, read the code, choose **Review and Run**, and approve the hash. It needs **Full page access**, because it adds a button to Marinara's editor and writes the colors through the editor's own form.

Every code change disables the extension until you review and approve the new hash.

## Limitations

- Char Avatar Dropper finds the Colors tab through React: it walks from the Extract button to the `CardColors` component and calls the same `onColorChange` the Extract button uses. A Marinara update that renames that component's props or the button's classes can stop the button from showing.
- The whole avatar is shown, not the circle crop. Avatars over 4096 px are scaled down to 4096 px before sampling.
- An avatar on another site that doesn't allow CORS can't be read by page code. You'll get an error message instead of the dialog. Avatars stored in Marinara work.

## Development

Nothing here touches a running Marinara.

- `npm test` runs the unit tests: color math, the skin/neutral guess, and the swatch ordering on a fake portrait.
- `npm run check` also compiles the extension the way Marinara wraps it.
- `npm run dev` serves a harness on http://localhost:5181 with a mock Colors tab and a fake avatar. You can load your own image there to try real avatars.
- `npm run smoke` drives the harness in headless Chrome. Set `CAD_PLAYWRIGHT` to a `playwright-core` folder and `CAD_CHROME` to a Chrome binary; `CAD_SHOTS` saves screenshots.
