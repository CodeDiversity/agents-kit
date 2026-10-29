import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export interface Predicate {
  always?: boolean;
  field?: string;
  eq?: unknown;
  in?: unknown[];
  gte?: number;
  all?: Predicate[];
  any?: Predicate[];
}

export interface SpecEdge {
  id: string;
  when: Predicate;
  to: string;
  assignment?: string;
  stage?: string;
  interrupt?: string;
  question?: string;
  parallel?: boolean;
}

export interface SpecNode {
  id: string;
  role?: string;
  fresh_context?: boolean;
  commit?: "none" | "specialist" | "coordinator";
  read_only?: boolean;
  interrupt?: string;
  writes?: string[];
}

export interface NonEdge {
  id: string;
  given?: Record<string, unknown>;
  never?: string[];
  expect?: string;
  interrupt?: string;
  entry_hints?: string[];
  note?: string;
}

export interface WorkflowSpec {
  version: number;
  edges: SpecEdge[];
  nodes: SpecNode[];
  non_edges: NonEdge[];
  non_nodes: string[];
  interrupts: Array<{ id: string }>;
}

const FENCE = /```yaml\n([\s\S]*?)```/g;

export function extractGraphFence(markdown: string): string {
  const fences = [...markdown.matchAll(FENCE)].map((match) => match[1] ?? "");
  const contract = fences.find((body) => /^version:\s*1\s*$/m.test(body) && /^edges:/m.test(body));
  if (!contract) throw new Error("workflow-graph.md is missing the graph contract YAML fence");
  return contract;
}

export function edgeOrderFromProse(markdown: string): string[] {
  const section = markdown.split("## Edge order")[1]?.split("## ")[0] ?? "";
  return [...section.matchAll(/^\| ([a-z0-9_]+) \|/gm)].map((match) => match[1] ?? "");
}

export function loadSpec(markdown: string): WorkflowSpec {
  const raw = parse(extractGraphFence(markdown)) as WorkflowSpec;
  if (!raw || raw.version !== 1) throw new Error("workflow graph spec must be version 1");
  if (!Array.isArray(raw.edges) || raw.edges.length === 0) throw new Error("workflow graph spec has no edges");
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) throw new Error("workflow graph spec has no nodes");
  const nodeIds = new Set(raw.nodes.map((node) => node.id));
  for (const edge of raw.edges) {
    if (!edge.id || !edge.to) throw new Error("every edge needs an id and a target");
    if (!nodeIds.has(edge.to)) throw new Error(`edge ${edge.id} targets unknown node ${edge.to}`);
    if (edge.parallel) throw new Error(`edge ${edge.id} must not fan out`);
  }
  const ids = raw.edges.map((edge) => edge.id);
  if (new Set(ids).size !== ids.length) throw new Error("edge ids must be unique");
  return {
    version: 1,
    edges: raw.edges,
    nodes: raw.nodes,
    non_edges: raw.non_edges ?? [],
    non_nodes: raw.non_nodes ?? [],
    interrupts: raw.interrupts ?? [],
  };
}

export function readSpecFile(file: string): WorkflowSpec {
  return loadSpec(fs.readFileSync(file, "utf8"));
}

export function resolveSpecPath(repo: string, kitRoot = path.resolve(import.meta.dirname, "../..")): string {
  const installed = path.join(repo, ".agents", "workflow-graph.md");
  if (fs.existsSync(installed)) return installed;
  const kit = path.join(kitRoot, "kit", ".agents", "workflow-graph.md");
  if (fs.existsSync(kit)) return kit;
  throw new Error(`No workflow-graph.md in ${repo} or ${kit}`);
}
