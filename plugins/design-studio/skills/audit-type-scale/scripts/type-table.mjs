#!/usr/bin/env node
// Turn measure-type.js results into a role-by-route table against a reference route.
//
//   node type-table.mjs <results.json> [--reference /]
//
// <results.json> is what run-matrix.mjs writes with --json when run with --script measure-type.js,
// or an array of {route, width, result} assembled by hand from browser-pane runs.
// For each width: one row per role, the reference route's dominant style, and each other route's
// style with its delta in px and as a ratio. Roles with more than one style on a route are listed
// after the table: that is drift inside the page, before any drift between pages.
import { readFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
const refIdx = argv.indexOf("--reference");
const reference = refIdx >= 0 ? argv[refIdx + 1] : "/";
if (!file) {
  console.error("usage: node type-table.mjs <results.json> [--reference /]");
  process.exit(2);
}

const order = ["hero-h1", "eyebrow", "lede", "section-label", "section-title", "subtitle", "body", "figure"];
const rows = JSON.parse(await readFile(file, "utf8")).map((r) => ({ ...r, result: typeof r.result === "string" ? JSON.parse(r.result) : r.result }));
const widths = [...new Set(rows.map((r) => r.width))].sort((a, b) => b - a);
const fmt = (s) => `${s.fontSize}/${s.lineHeight === "normal" ? "normal" : s.lineHeight} · ${s.fontWeight} · ${s.letterSpacing ? `${s.letterSpacingEm}em · ` : ""}${s.textTransform !== "none" ? `${s.textTransform} · ` : ""}${s.fontFamily}`;
const round = (n) => Math.round(n * 100) / 100;

function delta(ref, s) {
  if (!ref) return "";
  const parts = [];
  if (s.fontSize !== ref.fontSize) {
    const d = round(s.fontSize - ref.fontSize);
    parts.push(`size ${d > 0 ? "+" : ""}${d}px (${round(s.fontSize / ref.fontSize)}×)`);
  }
  if (s.lineHeightRatio !== ref.lineHeightRatio) parts.push(`lh ${s.lineHeightRatio ?? "normal"} vs ${ref.lineHeightRatio ?? "normal"}`);
  if (s.letterSpacingEm !== ref.letterSpacingEm) parts.push(`tracking ${s.letterSpacingEm}em vs ${ref.letterSpacingEm}em`);
  if (s.fontWeight !== ref.fontWeight) parts.push(`weight ${s.fontWeight} vs ${ref.fontWeight}`);
  if (s.fontFamily !== ref.fontFamily) parts.push(`family ${s.fontFamily}`);
  if (s.textTransform !== ref.textTransform) parts.push(`case ${s.textTransform}`);
  return parts.length ? ` ❌ ${parts.join(", ")}` : " ✅";
}

const out = [];
let mismatches = 0;
for (const width of widths) {
  const atWidth = rows.filter((r) => r.width === width && !r.result.error);
  const routes = [...new Set(atWidth.map((r) => r.route))].sort((a, b) => (a === reference ? -1 : b === reference ? 1 : a.localeCompare(b)));
  const byRoute = Object.fromEntries(atWidth.map((r) => [r.route, r.result]));
  if (!byRoute[reference]) {
    out.push(`\n## ${width}px\n\nThe reference route ${reference} was not measured at this width.`);
    continue;
  }
  const roles = [...new Set(atWidth.flatMap((r) => Object.keys(r.result.roles)))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  out.push(`\n## ${width}px (reference: ${reference})\n`);
  out.push(`| role | ${routes.map((r) => (r === reference ? `**${r}** (reference)` : r)).join(" | ")} |`);
  out.push(`| --- | ${routes.map(() => "---").join(" | ")} |`);
  const drift = [];
  for (const role of roles) {
    const ref = byRoute[reference].roles[role]?.[0];
    const cells = routes.map((route) => {
      const styles = byRoute[route].roles[role];
      if (!styles) return "—";
      if (styles.length > 1) drift.push(`- ${route} · ${role}: ${styles.length} styles: ${styles.map((s) => `${fmt(s)} ×${s.count} (\`${s.examples[0].selector}\`)`).join("; ")}`);
      const s = styles[0];
      if (route === reference) return fmt(s);
      const d = delta(ref, s);
      if (d.includes("❌")) mismatches++;
      return `${fmt(s)}${d}`;
    });
    out.push(`| ${role} | ${cells.join(" | ")} |`);
  }
  const divs = routes.map((route) => [route, byRoute[route].dividers || []]).filter(([, d]) => d.length);
  if (divs.length) {
    out.push("", "Dividers:");
    for (const [route, d] of divs) for (const x of d.slice(0, 4)) out.push(`- ${route} · \`${x.selector}\` · ${x.height}px tall, ${x.width}px wide, border ${x.borderTop}, margins ${x.marginBlock}`);
  }
  if (drift.length) out.push("", "More than one style for a role on the same route:", ...drift);
  out.push("", "Where each mismatched style comes from (and the reference it should match):");
  for (const role of roles) {
    const ref = byRoute[reference].roles[role]?.[0];
    const off = routes.filter((route) => route !== reference && byRoute[route].roles[role] && delta(ref, byRoute[route].roles[role][0]).includes("❌"));
    if (!off.length) continue;
    for (const route of [reference, ...off]) {
      const s = byRoute[route].roles[role]?.[0];
      if (s) out.push(`- ${role} · ${route} · \`${s.examples[0].selector}\`${s.examples[0].classes ? ` · class="${s.examples[0].classes}"` : ""} · "${s.examples[0].text}"`);
    }
  }
}
out.push(`\n${mismatches ? `${mismatches} cell(s) differ from the reference.` : "Every route matches the reference."}`);
console.log(out.join("\n"));
