import fs from "node:fs";
import path from "node:path";
import { loadSpec, resolveSpecPath } from "./spec.js";

function render(spec: ReturnType<typeof loadSpec>): string {
  const out: string[] = [];
  out.push("# Delivery workflow graph (rendered)");
  out.push("");
  out.push("Generated from `kit/.agents/workflow-graph.md` by `npm run render-graph`.");
  out.push("The YAML fence in that file is the source of truth; this file is a view.");
  out.push("");
  out.push("```mermaid");
  out.push("flowchart TD");
  out.push('  reconcile["reconcile"]');
  for (const node of spec.nodes) {
    const label = node.role && node.role !== "none" ? `${node.id}<br/><small>${node.role}</small>` : node.id;
    out.push(`  ${node.id}["${label}"]`);
  }
  const seen = new Set<string>();
  for (const edge of spec.edges) {
    const arrow = `  reconcile -->|${edge.id}| ${edge.to}`;
    if (!seen.has(arrow)) {
      out.push(arrow);
      seen.add(arrow);
    }
  }
  out.push("```");
  out.push("");
  out.push("## Edge table");
  out.push("");
  out.push("| Edge | Target |");
  out.push("| --- | --- |");
  for (const edge of spec.edges) {
    out.push(`| ${edge.id} | ${edge.to} |`);
  }
  out.push("");
  return out.join("\n");
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const specPath = resolveSpecPath(root);
const spec = loadSpec(fs.readFileSync(specPath, "utf8"));
const output = render(spec);

const write = process.argv.includes("--write");
if (write) {
  const target = path.join(root, "kit", "docs", "workflow-graph.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, output, "utf8");
  console.log(`wrote ${target}`);
} else {
  process.stdout.write(output);
}