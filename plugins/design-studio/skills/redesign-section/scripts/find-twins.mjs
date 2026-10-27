#!/usr/bin/env node
// Find every place that renders the same content as a section, before redesigning it.
//
//   node find-twins.mjs --section pillars [--root .] [--component <file>] [--data <file>] [--text "<copy>"]...
//
//   --section <name>     section name; seeds every component file whose name contains it (singular or plural)
//   --component <file>   the section's component, when the name alone is ambiguous (repeatable)
//   --data <file>        the module holding its content, when the component does not import one (repeatable)
//   --text <copy>        a phrase of the section's copy to search for verbatim (repeatable)
//
// It follows imports both ways: from the component to its data modules, then from each data module
// to every other file reading the section's part of it (a twin can render the same content through a
// different component), and from each of those up to the routes that render them (Next.js app and
// pages routers, Astro, SvelteKit, Remix, plain HTML pages, and React Router or Vue Router route
// tables, with nested paths joined). Where a seed is rendered, it prints the line and the nearest
// eyebrow, title or heading above it, since a twin can sit under a different name ("The Eliza
// Standard"). Then it searches the tree, public/ included, for the section's copy: string literals
// from its part of the data modules plus every --text, to catch hard-coded duplicates, JSON-LD,
// llms.txt and CMS seeds. In a git repository, ignored files (builds, generated bundles) are skipped.
// Node 18+, no dependencies. Read only.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
const COMPONENT = /\.(m?[jt]sx?|vue|svelte|astro)$/;
const TEXT = /\.(m?[jt]sx?|cjs|vue|svelte|astro|mdx?|json|html?|txt|ya?ml|xml)$/;
const rel = (f) => path.relative(root, f).split(path.sep).join("/") || ".";

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
// Tracked and untracked files minus ignored ones, so build output and generated bundles stay out.
function listFiles() {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\0").filter((f) => f && TEXT.test(f) && !f.split("/").some((s) => SKIP.has(s))).map((f) => path.join(root, f))
      .filter((f) => { try { return statSync(f).size < 2_000_000; } catch { return false; } });
  } catch {
    return walk(root);
  }
}
const files = listFiles();
const sources = files.filter((f) => CODE.test(f) || /\.html?$/.test(f));
const cache = new Map();
const read = (f) => {
  if (!cache.has(f)) { try { cache.set(f, readFileSync(f, "utf8")); } catch { cache.set(f, ""); } }
  return cache.get(f);
};

// "pillars" also names pillar-arches.tsx and getPillar(); "testimonials" names testimonial-card.
const stem = (s) => s.toLowerCase().replace(/[\s_-]+/g, "").replace(/ies$/, "y").replace(/([^s])s$/, "$1");
const needle = args.section ? stem(args.section) : "";
const named = (s) => Boolean(needle) && s.toLowerCase().replace(/[\s_-]+/g, "").includes(needle);

// Path aliases from tsconfig.json or jsconfig.json ("@/*": ["./src/*"]), with the common defaults as a fallback.
const aliases = [];
for (const cfg of ["tsconfig.json", "jsconfig.json", "tsconfig.app.json"]) {
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

// Imports with the names they bring in: `import { pillars, type Pillar } from "@/lib/content"` reads
// pillars and Pillar. A namespace, side-effect or dynamic import reads unknown names (null).
const IMPORT = /(?:import|export)\s+(?:type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]|<script[^>]+src=["']([^"']+)["']/g;
function namesOf(clause) {
  if (!clause || /\*/.test(clause)) return null;
  const names = [];
  const braces = clause.match(/\{([^}]*)\}/);
  for (const part of braces ? braces[1].split(",") : []) {
    const n = part.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim();
    if (n) names.push(n);
  }
  const def = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
  if (def) names.push(def);
  return names;
}
const imports = new Map(); // file -> Map(target -> names | null)
const importedBy = new Map();
for (const f of sources) {
  const deps = new Map();
  for (const m of read(f).matchAll(IMPORT)) {
    const spec = m[2] || m[3] || m[4] || m[5] || m[6];
    const target = resolveSpec(spec, f);
    if (!target || target === f) continue;
    const names = m[2] ? namesOf(m[1]) : null;
    const prev = deps.get(target);
    deps.set(target, prev === undefined ? names : prev && names ? [...prev, ...names] : null);
  }
  imports.set(f, deps);
  for (const d of deps.keys()) {
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
  const r = rel(f);
  const clean = (p) => "/" + p.split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@")).join("/");
  let m;
  if ((m = r.match(/^(?:src\/)?app\/(.*?)\/?page\.[jt]sx?$/)) || (m = r.match(/^(?:src\/)?app\/()page\.[jt]sx?$/))) return clean(m[1]);
  if ((m = r.match(/^(?:src\/)?app\/(.+?)\/route\.[jt]s$/))) return `${clean(m[1])} (route handler)`;
  if ((m = r.match(/^(?:src\/)?app\/(.*?)\/?layout\.[jt]sx?$/)) || (m = r.match(/^(?:src\/)?app\/()layout\.[jt]sx?$/))) return `${clean(m[1])} (layout: every route below)`;
  if (pagesRouter && (m = r.match(/^(?:src\/)?pages\/(.+)\.(?:[jt]sx?|astro|mdx?|vue)$/)) && !/^(_app|_document|api\/)/.test(m[1])) return clean(m[1].replace(/(^|\/)index$/, ""));
  if ((m = r.match(/^src\/routes\/(.*?)\/?\+page\.svelte$/))) return clean(m[1]);
  if ((m = r.match(/^app\/routes\/(.+)\.[jt]sx?$/))) return clean(m[1].replace(/\./g, "/").replace(/(^|\/)_index$/, ""));
  if ((m = r.match(/^(?:public\/)?(.+)\.html?$/))) return clean(m[1].replace(/(^|\/)index$/, ""));
  return null;
}
// A route table: it imports a router and declares routes (not a component that happens to be called Route).
const ROUTER_IMPORT = /from\s+['"](react-router(-dom)?|@remix-run\/react|@tanstack\/react-router|wouter|vue-router)['"]/;
const isRouter = (f) => ROUTER_IMPORT.test(read(f)) && /createBrowserRouter|createRoutesFromElements|<Route\b|useRoutes\(|createRouter\(/.test(read(f));

// The URL of each <Route> naming ident, with the paths of the <Route> elements it is nested in.
function routerPaths(f, ident) {
  const lines = read(f).split("\n");
  const out = [];
  const pathOf = (l) => { const m = l.match(/\bpath=(?:"([^"]*)"|'([^']*)'|\{([^}]*\}?)\})/); return m ? (m[1] ?? m[2] ?? `{${m[3]}}`) : /\bindex\b/.test(l) ? "" : null; };
  lines.forEach((line, i) => {
    // The route renders ident: <Route element={<Ident />}>, or { path, element: <Ident /> } / { Component: Ident }.
    if (!new RegExp(`<${ident}\\b|\\b(?:component|Component|element)\\s*[:=]\\s*\\{?\\s*${ident}\\b`).test(line)) return;
    const parts = [pathOf(line)];
    let indent = line.search(/\S/);
    for (let j = i - 1; j >= 0; j--) {
      const l = lines[j];
      const ind = l.search(/\S/);
      if (ind < 0 || ind >= indent) continue;
      if (/<Route\b/.test(l) && !/\/>\s*$/.test(l)) { parts.unshift(pathOf(l)); indent = ind; }
      else if (/<Routes\b/.test(l)) break;
    }
    const url = ("/" + parts.filter((p) => p).map((p) => p.replace(/^\/|\/$/g, "")).join("/")).replace(/\/+/g, "/");
    out.push(`\`${url}\` (${rel(f)}:${i + 1}: ${line.trim().slice(0, 110)})`);
  });
  return out;
}

function routesFor(start) {
  const found = new Map(); // route -> chain
  const routers = [];
  let sawRouter = false;
  const seen = new Set([start]);
  const queue = [[start, [start]]];
  while (queue.length) {
    const [f, chain] = queue.shift();
    const route = routeOf(f);
    if (route && !found.has(route)) found.set(route, chain);
    if (f !== start && isRouter(f)) {
      sawRouter = true;
      const prev = chain[chain.length - 2];
      const idents = [...(imports.get(f)?.get(prev) || [path.basename(prev).replace(/\.[^.]+$/, "")])];
      for (const ident of idents) for (const r of routerPaths(f, ident)) routers.push(`${r} via ${chain.map(rel).join(" → ")}`);
    }
    if (chain.length > 8) continue;
    for (const up of importedBy.get(f) || []) {
      if (seen.has(up)) continue;
      seen.add(up);
      queue.push([up, [...chain, up]]);
    }
  }
  // Behind a route table, the HTML entry is the single-page app's shell, not a route of its own.
  const shells = sawRouter ? [...found].filter(([, chain]) => /\.html?$/.test(chain[chain.length - 1])) : [];
  for (const [r] of shells) found.delete(r);
  if (shells.length && !routers.length) found.set("every route (the single-page app's shell)", shells[0][1]);
  return { found, routers };
}

// Where a file renders one of these names, with the nearest label above it: what the section is called on the page.
function placements(f, idents) {
  const lines = read(f).split("\n");
  const out = [];
  lines.forEach((line, i) => {
    // A component as JSX (<PillarArchLinks />), or a render function called by name (renderPillars(root)).
    if (!idents.some((id) => new RegExp(`<${id}[\\s/>]|\\b${id}\\s*\\(`).test(line)) || /^\s*(import|export)\b/.test(line)) return;
    const labels = [];
    for (let j = i; j >= Math.max(0, i - 25) && labels.length < 2; j--) {
      const l = lines[j];
      const m = l.match(/\b(eyebrow|label|kicker|title|heading)=\{?["'`]([^"'`]{3,80})/) || l.match(/<h[1-3][^>]*>\s*([^<{]{3,80})/) || l.match(/\bt\(\s*["']([\w.-]+\.(?:label|eyebrow|heading|title))["']/);
      if (m) labels.push(m.length > 2 ? `${m[1]} "${m[2].trim()}"` : `"${m[1].trim()}"`);
    }
    out.push(`- ${rel(f)}:${i + 1}: ${line.trim().slice(0, 90)}${labels.length ? ` · under ${labels.reverse().join(", ")}` : ""}`);
  });
  return out;
}

const isTest = (f) => /\.(test|spec|stories)\.|__tests__|__mocks__|\/e2e\//.test(f);
const DATA_DIR = /(^|\/)(data|content|constants|config|i18n|messages|locales|copy|lib)\//;
const seeds = new Set(args.component.map((c) => path.resolve(root, c)));
if (needle) {
  for (const f of sources) {
    // Components only: content modules and route or entry files are found from the components.
    if (named(path.basename(f).replace(/\.[^.]+$/, "")) && COMPONENT.test(f) && !/\.d\.ts$/.test(f) && !isTest(f) && !routeOf(f) && !DATA_DIR.test(rel(f)) && !/(^|\/)(pages|app|routes)\//.test(rel(f))) seeds.add(f);
  }
}

// A content module is "own" when it is the section's (data/pillars.ts) and "shared" when it holds other
// sections too (lib/content.ts, an i18n dictionary): then only the section's part of it counts.
const dataModules = new Map(args.data.map((d) => [path.resolve(root, d), "own"]));
const kind = (d) => (named(path.basename(d).replace(/\.[^.]+$/, "")) || args.data.some((x) => path.resolve(root, x) === d) ? "own" : "shared");
for (const s of seeds) for (const d of (imports.get(s) || new Map()).keys()) {
  if (DATA_DIR.test(rel(d)) || /\.(json|ya?ml|mdx?)$/.test(d)) dataModules.set(d, kind(d));
}
if (needle) for (const f of files) if (DATA_DIR.test(rel(f)) && named(path.basename(f).replace(/\.[^.]+$/, "")) && !isTest(f)) dataModules.set(f, "own");

// Does this importer read the section's part of a shared module? A section-named import (pillars,
// getCriteria), or a section-prefixed key ("criteria.heading") anywhere in the file.
const keyRef = needle ? new RegExp(`["'\`]${needle}[\\w-]*[.:]`, "i") : null;
const readsSection = (user, d) => {
  const names = imports.get(user)?.get(d);
  return (names && names.some(named)) || (keyRef && keyRef.test(read(user)));
};

const out = [];
const list = (title, items) => { out.push(`\n## ${title}\n`); out.push(...(items.length ? items : ["- none found"])); };
const routeLines = (f) => {
  const { found, routers } = routesFor(f);
  const lines = [...found].map(([r, chain]) => `  - \`${r}\` via ${chain.map(rel).join(" → ")}`);
  lines.push(...routers.map((r) => `  - ${r}`));
  return lines.length ? lines : ["  - no route reached (imported nowhere, or through a pattern this script does not follow: check by hand)"];
};

list("Seed components", [...seeds].map((s) => `- ${rel(s)}`));
list("Content modules they read", [...dataModules].map(([d, k]) => `- ${rel(d)}${k === "shared" ? " (shared with other sections: only the section's part counts)" : ""}`));
list("Routes rendering the seed components", [...seeds].flatMap((s) => [`- ${rel(s)}`, ...routeLines(s)]));

// Where the files importing `file` render it: a component, or a render function.
const renderedAt = (file, skip) => {
  const lines = [];
  for (const user of importedBy.get(file) || []) {
    if (skip.has(user) || isTest(user)) continue;
    const idents = imports.get(user).get(file) || [path.basename(file).replace(/\.[^.]+$/, "")];
    lines.push(...placements(user, idents.filter((n) => /^[A-Z]/.test(n) || /^(render|mount|create|build|draw)[A-Z]/.test(n))));
  }
  return lines;
};
list("Where each seed is rendered, and what the page calls that section", [...seeds].flatMap((s) => renderedAt(s, seeds)));

const readers = new Map(); // twin -> the content modules it reads
for (const [d, k] of dataModules) {
  for (const user of importedBy.get(d) || []) {
    if (seeds.has(user) || dataModules.has(user) || isTest(user)) continue;
    if (k === "shared" && !readsSection(user, d)) continue;
    readers.set(user, [...(readers.get(user) || []), d]);
  }
}
const twins = [];
for (const [user, mods] of readers) {
  const viaSeed = [...(imports.get(user)?.keys() || [])].some((x) => seeds.has(x));
  twins.push(`- ${rel(user)} reads ${mods.map(rel).join(", ")}${viaSeed ? " (and also renders a seed component)" : ""}`, ...routeLines(user));
}
list("Twins: other files reading the same content", twins);
list("Where each twin is rendered, and what the page calls it", [...readers.keys()].flatMap((t) => renderedAt(t, seeds)));

// Copy search: distinctive string literals from the section's content, plus every --text. In a shared
// module, the section's content is its section-named declarations and the lines naming its keys.
function sectionText(d, k) {
  const src = read(d);
  if (k === "own") return src;
  const parts = [];
  const decl = new RegExp(`(?:^|\\n)(?:export\\s+)?(?:const|let|var|function)\\s+(\\w+)`, "g");
  const starts = [...src.matchAll(decl)].map((m) => ({ name: m[1], at: m.index }));
  starts.forEach((s, i) => { if (named(s.name)) parts.push(src.slice(s.at, starts[i + 1]?.at ?? src.length)); });
  const lines = src.split("\n");
  lines.forEach((l, i) => { if (keyRef && keyRef.test(l)) parts.push(l, /:\s*$/.test(l) ? lines[i + 1] || "" : ""); });
  return parts.join("\n");
}
const phrases = new Set(args.text);
for (const [d, k] of dataModules) {
  const lits = [...sectionText(d, k).matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){20,140})\1/g)].map((m) => m[2]).filter((s) => /\s/.test(s) && !/^(https?:|\/|\.|@)/.test(s) && !/[{}<>]/.test(s));
  for (const s of [...new Set(lits)].slice(0, 8)) phrases.add(s.slice(0, 60));
}
const copyHits = [];
const seedTree = new Set([...seeds].flatMap((s) => [s, ...(importedBy.get(s) || [])]));
for (const phrase of phrases) {
  const lower = phrase.toLowerCase();
  const hits = files.filter((f) => !dataModules.has(f) && !isTest(f) && read(f).toLowerCase().includes(lower));
  // A phrase all over the site is the brand or boilerplate, not this section's copy.
  if (hits.length > 8) copyHits.push(`- "${phrase}": in ${hits.length} files, too common to be this section's copy (not listed)`);
  else if (hits.length) copyHits.push(`- "${phrase}"`, ...hits.map((h) => `  - ${rel(h)}${seedTree.has(h) ? " (renders the section)" : ""}`));
}
list("The same copy elsewhere (hard-coded duplicates, JSON-LD, llms.txt, CMS seeds)", copyHits);
out.push("\nStop here and list every twin and copy hit to the user before mocking anything: each one either changes with the redesign or is named as out of scope.");
console.log(`# Twins of "${args.section || [...seeds].map(rel).join(", ")}" in ${root}` + out.join("\n"));
