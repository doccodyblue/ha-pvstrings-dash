// Screenshot harness for docs/img. Needs the dev server (tools/serve.mjs) and
// a playwright-core install; PLAYWRIGHT_PATH overrides where to find it.
import { createRequire } from "node:module";
const req = createRequire(process.env.PLAYWRIGHT_PATH ?? import.meta.url);
const { chromium } = req("playwright-core");

const OUT = new URL("../docs/img", import.meta.url).pathname;
const specs = [
  ["#sky",    520, "sky-map-dark.png"],
  ["#n",      480, "forecast-line-dark.png"],
  ["#conv1",  840, "conversion-dark.png"],
  ["#curve1", 840, "curve-dark.png"],
  ["#nc1",    480, "nowcast-dark.png"],
  ["#matn",   480, "maturity-dark.png"],
];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
await p.goto("http://localhost:8099/tools/mock-preview.html?dark=1", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
// the harness labels sit right under each card — hide them so the margin
// around a capture is clean background
await p.evaluate(() => document.querySelectorAll("h4").forEach((e) => { e.style.visibility = "hidden"; }));
for (const [sel, w, file] of specs) {
  await p.evaluate(([s, width]) => {
    const el = document.querySelector(s);
    el.style.width = width + "px";
    el.scrollIntoView();
  }, [sel, w]);
  await p.waitForTimeout(350);
  const box = await p.locator(sel).boundingBox();
  const M = 12;
  await p.screenshot({ path: `${OUT}/${file}`, clip: {
    x: Math.max(0, box.x - M), y: Math.max(0, box.y - M),
    width: box.width + 2 * M, height: box.height + 2 * M } });
  console.log("wrote", file);
}
console.log(errs.length ? "ERRORS: " + errs.join(" | ") : "no page errors");
await b.close();
