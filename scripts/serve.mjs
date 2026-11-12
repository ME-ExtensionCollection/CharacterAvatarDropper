// Dev harness server: builds the extension, then serves the repo on
// http://localhost:5181/dev/harness.html with a mock Colors tab.
// Nothing here talks to a real Marinara install.
//
// Usage: node scripts/serve.mjs [port]
//   GET /dev/avatar.png    the fake avatar (dev/fake-avatar.mjs), 4× size
//   GET /external/avatar.png  the same image without CORS, for the "other site" path
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeAvatar, toPng } from "../dev/fake-avatar.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

export function serve(port = 5181) {
  execFileSync(process.execPath, [join(ROOT, "scripts/build.mjs")], { stdio: "inherit" });
  const png = toPng(fakeAvatar(4));
  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/") {
        res.writeHead(302, { Location: "/dev/harness.html" });
        return res.end();
      }
      if (url.pathname === "/dev/avatar.png" || url.pathname === "/external/avatar.png") {
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
        return res.end(png);
      }
      const file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
      if (!file.startsWith(ROOT) || /[/\\]\.|node_modules/.test(file.slice(ROOT.length))) return send(res, 404, { error: "Not found" });
      const content = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(content);
    } catch (error) {
      if (!res.headersSent) send(res, error.code === "ENOENT" ? 404 : 500, { error: String(error.message ?? error) });
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { port } = await serve(Number(process.argv[2]) || 5181);
  console.log(`Harness: http://localhost:${port}/dev/harness.html`);
}
