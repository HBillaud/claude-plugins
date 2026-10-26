#!/usr/bin/env node
// Find every place that renders the same content as a section, before redesigning it.
//
//   node find-twins.mjs --section pillars [--root .] [--component <file>] [--data <file>] [--text "<copy>"]...
//
//   --section <name>     section name; seeds every component file whose name contains it
//   --component <file>   the section's component, when the name alone is ambiguous (repeatable)
//   --data <file>        the module holding its content, when the component does not import one (repeatable)
//   --text <copy>        a phrase of the section's copy to search for verbatim (repeatable)
//
// It follows imports both ways: from the component to its data modules, then from each data module
// to every other file importing it (a twin can render the same content through a different component),
// and from each of those up to the routes that render them (Next.js app and pages routers, Astro,
// SvelteKit, Remix, plain HTML pages; React Router files are listed with the lines that name them).
// Then it searches the whole tree, public/ included, for the section's copy: string literals from its
// data modules plus every --text, to catch hard-coded duplicates, JSON-LD, llms.txt and CMS seeds.
// Node 18+, no dependencies. Read only.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const args = { root: ".", component: [], data: [], text: [] };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const k = argv[i].replace(/^--/, "");
  const v = argv[i + 1];
  if (v === undefined) throw new Error(`--${k} needs a value`);
  if (Array.isArray(args[k])) args[k].push(v);
  else args[k] = v;
}
if (!args.section && !args.component.length) {
  console.error("usage: node find-twins.mjs --section <name> [--root .] [--component <file>] [--data <file>] [--text <copy>]");
  process.exit(2);
}

const root = path.resolve(args.root);
const SKIP = new Set(["node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".astro", ".vercel", ".netlify", ".turbo", ".cache", "dist", "build", "out", "coverage", ".claude"]);
const CODE = /\.(m?[jt]sx?|cjs|vue|svelte|astro|mdx?)$/;
const TEXT = /\.(m?[jt]sx?|cjs|vue|svelte|astro|mdx?|json|html?|txt|ya?ml|xml)$/;
const rel = (f) => path.relative(root, f) || ".";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (TEXT.test(name) && st.size < 2_000_000) out.push(full);
  }
  return out;
}
const files = walk(root);
const sources = files.filter((f) => CODE.test(f) || /\.html?$/.test(f));
const read = (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };

// Path aliases from tsconfig.json or jsconfig.json ("@/*": ["./src/*"]), with the common defaults as a fallback.
const aliases = [];
for (const cfg of ["tsconfig.json", "jsconfig.json"]) {
  const p = path.join(root, cfg);
  if (!existsSync(p)) continue;
  try {
    const json = JSON.parse(read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1"));
    const base = path.resolve(root, json.compilerOptions?.baseUrl || ".");
    for (const [from, to] of Object.entries(json.compilerOptions?.paths || {})) {
      aliases.push([from.replace(/\*$/, ""), to.map((t) => path.resolve(base, t.replace(/\*$/, "")))]);
    }
  } catch {}
}
for (const [from, dir] of [["@/", "src"], ["~/", "src"], ["@/", "."], ["~/", "."]]) aliases.push([from, [path.join(root, dir)]]);

const EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".json", ".mdx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs"];
function resolveSpec(spec, from) {
  let bases = [];
  if (spec.startsWith(".")) bases = [path.resolve(path.dirname(from), spec)];
  else if (spec.startsWith("/")) bases = [path.join(root, spec)];
  else for (const [prefix, dirs] of aliases) if (spec.startsWith(prefix)) bases.push(...dirs.map((d) => path.join(d, spec.slice(prefix.length))));
  for (const b of bases) for (const e of EXT) {
    const f = b + e;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]|<script[^>]+src=["']([^"']+)["']/g;
const imports = new Map();
const importedBy = new Map();
for (const f of sources) {
  const deps = new Set();
  for (const m of read(f).matchAll(IMPORT)) {
    const spec = m[1] || m[2] || m[3] || m[4] || m[5];
    const target = resolveSpec(spec, f);
    if (target && target !== f) deps.add(target);
  }
  imports.set(f, deps);
  for (const d of deps) {
    if (!importedBy.has(d)) importedBy.set(d, new Set());
    importedBy.get(d).add(f);
  }
}

// Which file-based routers apply: a pages/ directory is only a router under Next.js, Astro or Nuxt.
const pkg = (() => { try { return JSON.parse(read(path.join(root, "package.json"))); } catch { return {}; } })();
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const pagesRouter = Boolean(deps.next || deps.astro || deps.nuxt);

// Route entries and the URL each one serves.
function routeOf(f) {
  const r = rel(f).split(path.sep).join("/");
  const clean = (p) => "/" + p.split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@")).join("/");
  let m;
  if ((m = r.match(/^(?:src\/)?app\/(.*?)\/?page\.[jt]sx?$/)) || (m = r.match(/^(?:src\/)?app\/()page\.[jt]sx?$/))) return clean(m[1]);
  if ((m = r.match(/^(?:src\/)?app\/(.*?)\/?layout\.[jt]sx?$/)) || (m = r.match(/^(?:src\/)?app\/()layout\.[jt]sx?$/))) return `${clean(m[1])} (layout: every route below)`;
  if (pagesRouter && (m = r.match(/^(?:src\/)?pages\/(.+)\.(?:[jt]sx?|astro|mdx?|vue)$/)) && !/^(_app|_document|api\/)/.test(m[1])) return clean(m[1].replace(/(^|\/)index$/, ""));
  if ((m = r.match(/^src\/routes\/(.*?)\/?\+page\.svelte$/))) return clean(m[1]);
  if ((m = r.match(/^app\/routes\/(.+)\.[jt]sx?$/))) return clean(m[1].replace(/\./g, "/").replace(/(^|\/)_index$/, ""));
  if ((m = r.match(/^(?:public\/)?(.+)\.html?$/)) && !r.startsWith("node_modules")) return clean(m[1].replace(/(^|\/)index$/, ""));
  return null;
}
const isRouter = (f) => /createBrowserRouter|createRoutesFromElements|<Route\b|useRoutes\(|createRouter\(/.test(read(f));

function routesFor(start) {
  const found = new Map(); // route -> chain
  const routers = new Map();
  const seen = new Set([start]);
  const queue = [[start, [start]]];
  while (queue.length) {
    const [f, chain] = queue.shift();
    const route = routeOf(f);
    if (route && !found.has(route)) found.set(route, chain);
    if (isRouter(f) && f !== start) {
      const prev = chain[chain.length - 2];
      const ident = prev ? path.basename(prev).replace(/\.[^.]+$/, "") : "";
      const lines = read(f).split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => ident && l.includes(ident) && /path|Route|element|component/.test(l));
      routers.set(f, lines.map(([n, l]) => `${rel(f)}:${n}: ${l.trim().slice(0, 140)}`));
    }
    if (chain.length > 8) continue;
    for (const up of importedBy.get(f) || []) {
      if (seen.has(up)) continue;
      seen.add(up);
      queue.push([up, [...chain, up]]);
    }
  }
  return { found, routers };
}

const isTest = (f) => /\.(test|spec|stories)\.|__tests__|__mocks__|\/e2e\//.test(f);
const seeds = new Set(args.component.map((c) => path.resolve(root, c)));
if (args.section) {
  const needle = args.section.toLowerCase().replace(/[\s_-]+/g, "");
  for (const f of sources) {
    const base = path.basename(f).replace(/\.[^.]+$/, "").toLowerCase().replace(/[\s_-]+/g, "");
    // Components only: content modules and route or entry files are found from the components.
    if (base.includes(needle) && !isTest(f) && CODE.test(f) && !routeOf(f) && !/(^|\/)(data|content|lib|constants|config|i18n|messages|locales|pages|app|routes)\//.test(rel(f))) seeds.add(f);
  }
}
const DATA_DIR = /(^|\/)(data|content|constants|config|i18n|messages|locales|copy|lib)\//;
const dataModules = new Set(args.data.map((d) => path.resolve(root, d)));
for (const s of seeds) for (const d of imports.get(s) || []) {
  if (DATA_DIR.test(rel(d)) || /\.(json|ya?ml|mdx?)$/.test(d)) dataModules.add(d);
}
if (args.section) {
  const needle = args.section.toLowerCase();
  for (const f of files) if (DATA_DIR.test(rel(f)) && path.basename(f).toLowerCase().includes(needle) && !isTest(f)) dataModules.add(f);
}

const out = [];
const list = (title, items) => { out.push(`\n## ${title}\n`); out.push(...(items.length ? items : ["- none found"])); };
const routeLines = (f) => {
  const { found, routers } = routesFor(f);
  const lines = [...found].map(([r, chain]) => `  - \`${r}\` via ${chain.map(rel).join(" → ")}`);
  for (const [, ls] of routers) lines.push(...(ls.length ? ls.map((l) => `  - router: ${l}`) : []));
  return lines.length ? lines : ["  - no route reached (imported nowhere, or through a pattern this script does not follow: check by hand)"];
};

list("Seed components", [...seeds].map((s) => `- ${rel(s)}`));
list("Content modules they read", [...dataModules].map((d) => `- ${rel(d)}`));
list("Routes rendering the seed components", [...seeds].flatMap((s) => [`- ${rel(s)}`, ...routeLines(s)]));

const twins = [];
const seedTree = new Set([...seeds].flatMap((s) => [s, ...(importedBy.get(s) || [])]));
for (const d of dataModules) {
  for (const user of importedBy.get(d) || []) {
    if (seeds.has(user) || isTest(user)) continue;
    const viaSeed = [...(imports.get(user) || [])].some((x) => seeds.has(x));
    twins.push(`- ${rel(user)} reads ${rel(d)}${viaSeed ? " (and also renders a seed component)" : ""}`, ...routeLines(user));
  }
}
list("Twins: other files reading the same content", twins);

// Copy search: distinctive string literals from the content modules, plus every --text.
const phrases = new Set(args.text);
for (const d of dataModules) {
  const lits = [...read(d).matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){24,140})\1/g)].map((m) => m[2]).filter((s) => /\s/.test(s) && !/^(https?:|\/|\.|@)/.test(s) && !/[{}<>]/.test(s));
  for (const s of lits.slice(0, 6)) phrases.add(s.slice(0, 60));
}
const copyHits = [];
for (const phrase of phrases) {
  const needle = phrase.toLowerCase();
  const hits = files.filter((f) => !dataModules.has(f) && !isTest(f) && read(f).toLowerCase().includes(needle));
  if (hits.length) copyHits.push(`- "${phrase}"`, ...hits.map((h) => `  - ${rel(h)}${seedTree.has(h) ? " (renders the section)" : ""}`));
}
list("The same copy elsewhere (hard-coded duplicates, JSON-LD, llms.txt, CMS seeds)", copyHits);
out.push("\nStop here and list every twin and copy hit to the user before mocking anything: each one either changes with the redesign or is named as out of scope.");
console.log(`# Twins of "${args.section || [...seeds].map(rel).join(", ")}" in ${root}` + out.join("\n"));
