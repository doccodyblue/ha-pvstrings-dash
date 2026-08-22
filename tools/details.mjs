// Screenshot harness for docs/img. Needs the dev server (tools/serve.mjs) and
// a playwright-core install; PLAYWRIGHT_PATH overrides where to find it.
import { createRequire } from "node:module";
const req = createRequire(process.env.PLAYWRIGHT_PATH ?? import.meta.url);
const { chromium } = req("playwright-core");
const OUT = new URL("../docs/img", import.meta.url).pathname;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto("http://localhost:8099/tools/mock-preview.html?dark=1", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
await p.evaluate(() => document.querySelectorAll("h4").forEach((e) => { e.style.visibility = "hidden"; }));

// Each detail is a window into a card's own SVG, computed from the live
// geometry so the crop survives data changes.
const shots = [
  // hatch grammar: unobserved sky cells beside observed ones
  { file: "read-hatch-dark.png", sel: "#sky", width: 560,
    frac: { x0: 0.02, x1: 0.62, y0: 0.30, y1: 0.92 } },
  // prior vs applied vs measurement, filled and hollow markers
  { file: "read-curve-dark.png", sel: "#curve1", width: 860,
    frac: { x0: 0.0, x1: 0.55, y0: 0.16, y1: 0.80 } },
  // the second strip: ratio per hour, hatched where DC is too small
  { file: "read-strip-dark.png", sel: "#conv1", width: 860,
    frac: { x0: 0.0, x1: 1.0, y0: 0.55, y1: 1.0 } },
];

// the withheld state gets a whole (small) card: it is the repo's first design
// rule, and the nowcast's inactive case is its clearest instance
await p.evaluate(() => { const e = document.querySelector("#nc2"); e.style.width = "560px"; e.scrollIntoView(); });
await p.waitForTimeout(300);
{
  const box = await p.locator("#nc2").boundingBox();
  const M = 10;
  await p.screenshot({ path: `${OUT}/read-withheld-dark.png`, clip: {
    x: box.x - M, y: box.y - M, width: box.width + 2 * M, height: box.height + 2 * M } });
  console.log("wrote read-withheld-dark.png");
}

for (const s of shots) {
  await p.evaluate(([sel, w]) => {
    const el = document.querySelector(sel);
    el.style.width = w + "px";
    el.scrollIntoView();
  }, [s.sel, s.width]);
  await p.waitForTimeout(300);
  const box = await p.evaluate((sel) => {
    const host = document.querySelector(sel).firstElementChild;
    const svg = host.shadowRoot.querySelector("svg.fc-line, .sky-wrap svg");
    const r = svg.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, s.sel);
  const f = s.frac;
  await p.screenshot({ path: `${OUT}/${s.file}`, clip: {
    x: box.x + box.w * f.x0, y: box.y + box.h * f.y0,
    width: box.w * (f.x1 - f.x0), height: box.h * (f.y1 - f.y0) } });
  console.log("wrote", s.file, Math.round(box.w * (f.x1 - f.x0)), "x", Math.round(box.h * (f.y1 - f.y0)));
}
await b.close();
