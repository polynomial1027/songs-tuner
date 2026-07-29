import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the SingRight landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /SingRight/);
  assert.match(html, /把每一个音/);
  assert.match(html, /逐音校准/);
  assert.match(html, /五线谱制谱软件/);
  assert.match(html, /\.singright\.json/);
  assert.match(html, /音频只在本机处理/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("removes starter metadata and preview files", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(page, /SingRight/);
  assert.match(page, /五线谱编辑器/);
  assert.match(page, /MusicXML/);
  assert.match(layout, /SingRight 准唱/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview|_sites-preview/);

  await assert.rejects(
    access(new URL("app/_sites-preview", templateRoot)),
  );
});
