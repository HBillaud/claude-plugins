#!/usr/bin/env node
// Run a page script (probes.js by default) across a viewport matrix in headless Chromium.
//
//   node run-matrix.mjs --base http://localhost:3000 --routes /,/about [options]
//
//   --base <url>            site origin (required)
//   --routes <a,b>          paths to visit (default /)
//   --widths <a,b>          viewport widths (default 375,390,768,1024,1280,1440)
//   --height <px>           viewport height (default 900; 812 under 768px wide)
//   --reduced <on|off|both> prefers-reduced-motion (default both)
//   --scheme <light|dark|both>  prefers-color-scheme (default light)
//   --scope <selector>      only report elements inside it (probes.js)
//   --script <path>         page script to run instead of probes.js (it must evaluate to a JSON string)
//   --opts <json>           extra options for the page script, set as globalThis.__DS_PROBE_OPTS
//   --baseline <url>        run the same matrix on this origin too (production) and mark findings it lacks as new
//   --shots <dir>           save a screenshot of each failing element (probes.js only)
//   --json <file>           write every result as JSON
//
// Prints a Markdown table per route for probes.js, or the raw JSON for any other script.
// Needs the playwright package (and its Chromium) resolvable from the working directory or NODE_PATH.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { routes: "/", widths: "375,390,768,1024,1280,1440", reduced: "both", scheme: "light", height: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${a} needs a value`);
    args[key] = value;
    i++;
  }
  if (!args.base) throw new Error("--base <url> is required");
  return args;
}

async function loadPlaywright() {
  const require = createRequire(path.join(process.cwd(), "noop.js"));
  for (const name of ["playwright", "playwright-core", "@playwright/test"]) {
    try {
      return require(name);
    } catch {}
    try {
      return await import(name);
    } catch {}
  }
  throw new Error(
    "playwright is not installed here. Use the browser pane instead (see SKILL.md), or install it outside the project:\n" +
      "  npm i --prefix <dir> playwright@1.63.0 && npx --prefix <dir> playwright install chromium\n" +
      "  NODE_PATH=<dir>/node_modules node run-matrix.mjs ...",
  );
}

const both = (v, on, off) => (v === "both" ? [on, off] : v === on ? [on] : [off]);
const key = (kind, f) => `${kind}|${f.selector}`;
const kinds = ["overflow", "clipped", "hidden", "targets", "images", "motion"];

async function runMatrix(browser, base, args, script) {
  const routes = args.routes.split(",").map((r) => r.trim()).filter(Boolean);
  const widths = args.widths.split(",").map(Number);
  const results = [];
  for (const scheme of both(args.scheme, "dark", "light")) {
    for (const reduced of both(args.reduced, "on", "off")) {
      const context = await browser.newContext({
        colorScheme: scheme,
        reducedMotion: reduced === "on" ? "reduce" : "no-preference",
        deviceScaleFactor: 2,
      });
      for (const route of routes) {
        for (const width of widths) {
          const height = Number(args.height) || (width < 768 ? 812 : 900);
          const page = await context.newPage();
          await page.setViewportSize({ width, height });
          const consoleErrors = [];
          page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));
          page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 300)));
          const url = new URL(route, base).href;
          let result;
          try {
            await page.goto(url, { waitUntil: "load", timeout: 45000 });
            await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
            const opts = { ...(args.opts ? JSON.parse(args.opts) : {}), ...(args.scope ? { scope: args.scope } : {}) };
            await page.evaluate((o) => (globalThis.__DS_PROBE_OPTS = o), opts);
            result = JSON.parse(await page.evaluate(script));
          } catch (e) {
            result = { error: String(e.message || e).split("\n")[0] };
          }
          result.consoleErrors = consoleErrors;
          results.push({ route, width, height, reduced, scheme, page, result });
        }
      }
    }
  }
  return results;
}

function hydrationErrors(errors) {
  return errors.filter((e) => /hydrat|did not match|server rendered|Minified React error #4(18|19|23|25)/i.test(e));
}

function table(results, baseline) {
  const lines = [];
  const byRoute = new Map();
  for (const r of results) {
    if (!byRoute.has(r.route)) byRoute.set(r.route, []);
    byRoute.get(r.route).push(r);
  }
  for (const [route, rows] of byRoute) {
    lines.push(`\n### ${route}\n`);
    lines.push("| width | scheme | reduced | doc overflow | overflow | clipped | hidden | tap <44 | soft img | motion | console | verdict |");
    lines.push("| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const r of rows) {
      const x = r.result;
      if (x.error) {
        lines.push(`| ${r.width} | ${r.scheme} | ${r.reduced} | error: ${x.error} |||||||||`);
        continue;
      }
      const hyd = hydrationErrors(x.consoleErrors).length;
      const docOver = x.document.scrollWidth > x.document.clientWidth + 1 ? `❌ ${x.document.scrollWidth}/${x.document.clientWidth}` : "✅";
      const n = (k, count) => {
        if (!baseline) return String(count);
        const fresh = (r.newKeys || new Set()).size && [...r.newKeys].filter((s) => s.startsWith(`${k}|`)).length;
        return fresh ? `${count} (${fresh} new)` : String(count);
      };
      const f = x.fails;
      const bad = f.overflow + f.clipped + f.hidden + f.images + f.motion + f.overlays + hyd;
      const verdict = bad ? "❌" : f.targets || x.images.length || x.clipped.length ? "⚠️" : "✅";
      lines.push(
        `| ${r.width} | ${r.scheme} | ${r.reduced} | ${docOver} | ${n("overflow", x.overflow.length)} | ${n("clipped", f.clipped)}${x.clipped.length - f.clipped ? ` (+${x.clipped.length - f.clipped} intended)` : ""} | ${n("hidden", f.hidden)} | ${n("targets", f.targets)} | ${n("images", x.images.length)} | ${n("motion", f.motion)} | ${x.consoleErrors.length}${hyd ? ` (${hyd} hydration)` : ""} | ${verdict} |`,
      );
    }
    const details = [];
    for (const r of rows) {
      const x = r.result;
      if (x.error) continue;
      for (const k of kinds) {
        for (const item of x[k]) {
          const fresh = r.newKeys && r.newKeys.has(key(k, item)) ? " **new**" : "";
          const extra = Object.entries(item)
            .filter(([p]) => !["selector", "box", "text"].includes(p))
            .map(([p, v]) => `${p}=${v}`)
            .join(", ");
          details.push(`- ${r.width}px ${r.scheme}${r.reduced === "on" ? " reduced" : ""} · ${k}${fresh} · \`${item.selector}\` · ${extra}${item.text ? ` · "${item.text}"` : ""}`);
        }
      }
      for (const e of x.consoleErrors) details.push(`- ${r.width}px · console · ${e}`);
      for (const o of x.overlays) details.push(`- ${r.width}px · overlay · ${o}`);
    }
    if (details.length) lines.push("", "Findings:", "", ...details);
  }
  return lines.join("\n");
}

async function shoot(results, dir) {
  await mkdir(dir, { recursive: true });
  const saved = [];
  for (const r of results) {
    const x = r.result;
    if (x.error) continue;
    const failing = [
      ...x.overflow.map((i) => ["overflow", i]),
      ...x.clipped.filter((c) => !c.intended).map((i) => ["clipped", i]),
      ...x.hidden.map((i) => ["hidden", i]),
      ...x.images.filter((i) => i.severity === "fail").map((i) => ["images", i]),
    ].slice(0, 6);
    for (const [k, item] of failing) {
      const slug = `${r.route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}-${r.width}-${r.scheme}${r.reduced === "on" ? "-reduced" : ""}-${k}-${saved.length}.png`;
      const file = path.join(dir, slug);
      try {
        const loc = r.page.locator(item.selector).first();
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
        await r.page.screenshot({ path: file });
        saved.push(file);
      } catch {}
    }
  }
  return saved;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptPath = args.script ? path.resolve(args.script) : path.join(here, "probes.js");
  const script = await readFile(scriptPath, "utf8");
  const isProbes = path.basename(scriptPath) === "probes.js";
  const pw = await loadPlaywright();
  const chromium = pw.chromium || (pw.default && pw.default.chromium);
  const browser = await chromium.launch();
  try {
    const results = await runMatrix(browser, args.base, args, script);
    if (args.baseline && isProbes) {
      const base = await runMatrix(browser, args.baseline, args, script);
      for (const r of results) {
        const twin = base.find((b) => b.route === r.route && b.width === r.width && b.reduced === r.reduced && b.scheme === r.scheme);
        const known = new Set();
        if (twin && !twin.result.error) for (const k of kinds) for (const i of twin.result[k]) known.add(key(k, i));
        r.newKeys = new Set();
        if (!r.result.error) for (const k of kinds) for (const i of r.result[k]) if (!known.has(key(k, i))) r.newKeys.add(key(k, i));
      }
      for (const b of base) await b.page.close();
    }
    const plain = results.map(({ page, newKeys, ...rest }) => ({ ...rest, newFindings: newKeys ? [...newKeys] : undefined }));
    if (args.json) await writeFile(args.json, JSON.stringify(plain, null, 2));
    if (isProbes) {
      console.log(table(results, Boolean(args.baseline)));
      if (args.shots) {
        const saved = await shoot(results, args.shots);
        console.log(`\nScreenshots of failures (${saved.length}):`);
        for (const s of saved) console.log(`- ${s}`);
      }
    } else {
      console.log(JSON.stringify(plain, null, 2));
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
