import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyState, readCheckpoint } from "./checkpoint.js";
import { compileGraph, invokeGraph } from "./graph.js";
import { connectOpenCode } from "./hosts/opencode.js";
import { reconcile } from "./reconcile.js";
import { route, toGateRecord } from "./router.js";
import { resolveSpecPath, readSpecFile } from "./spec.js";

interface Args {
  command: string;
  repo: string;
  parent: string;
  readme: string;
  entry: string;
  limits: string;
  answer: string;
  host: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: argv[0] ?? "status",
    repo: "",
    parent: "",
    readme: "",
    entry: "",
    limits: "",
    answer: "",
    host: "opencode",
  };
  for (let i = 1; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1] ?? "";
    if (key === "--repo") args.repo = path.resolve(value);
    else if (key === "--parent") args.parent = value;
    else if (key === "--readme") args.readme = path.resolve(value);
    else if (key === "--entry") args.entry = value;
    else if (key === "--limits") args.limits = value;
    else if (key === "--answer") args.answer = value;
    else if (key === "--host") args.host = value;
    else throw new Error(`Unknown argument ${key}`);
    i += 1;
  }
  return args;
}

function lastPath(): string {
  const root = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(root, "agents-kit", "last.json");
}

function remember(repo: string, readme: string, parent: string): void {
  const file = lastPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { readme: string; parent: string }> : {};
  current[repo] = { readme, parent };
  fs.writeFileSync(file, JSON.stringify(current, null, 2));
}

function recall(repo: string): { readme: string; parent: string } | null {
  const file = lastPath();
  if (!fs.existsSync(file)) return null;
  const current = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { readme: string; parent: string }>;
  return current[repo] ?? null;
}

function findReadme(repo: string, parent: string): string {
  const root = path.join(repo, "docs", "stories");
  if (!fs.existsSync(root)) throw new Error(`No docs/stories directory in ${repo}`);
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === parent && fs.existsSync(path.join(full, "README.md"))) hits.push(path.join(full, "README.md"));
        else walk(full);
      }
    }
  };
  walk(root);
  if (hits.length !== 1) throw new Error(hits.length === 0 ? `No README for parent ${parent}` : `Multiple READMEs for ${parent}: ${hits.join(", ")}`);
  return hits[0] ?? "";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!["status", "run", "resume"].includes(args.command)) {
    throw new Error("Usage: agents-kit <status|run|resume> --repo <path> [--parent <id>] [--readme <path>] [--entry <hint>] [--answer <text>] [--host opencode]");
  }
  if (!args.repo) throw new Error("--repo is required");
  if (args.host !== "opencode") {
    throw new Error(`${args.host} has no free local isolated-session API wired here. Use in-session autopilot; it follows the same workflow-graph.md. Codex and Vibe are not guessed.`);
  }
  const remembered = recall(args.repo);
  const readme = args.readme || (args.parent ? findReadme(args.repo, args.parent) : remembered?.readme ?? "");
  if (!readme) throw new Error("Pass --parent or --readme. resume can reuse the last local pointer.");
  const spec = readSpecFile(resolveSpecPath(args.repo));
  const loaded = readCheckpoint(readme);
  const seed = loaded.state ?? emptyState({ readmePath: readme, scope: { parent: args.parent || remembered?.parent || path.basename(path.dirname(readme)), descendants: [], entry: args.entry, limits: args.limits || "enclosing parent review unit" } });
  seed.readmePath = readme;
  seed.coordinator.workspace = args.repo;
  if (args.entry) seed.scope.entry = args.entry;
  if (args.limits) seed.scope.limits = args.limits;
  if (args.parent) seed.scope.parent = args.parent;
  if (args.answer) seed.blocker.answer = args.answer;
  const state = await reconcile({ repo: args.repo, readmePath: readme, sessionLive: seed.sessionLive });
  state.scope.entry = seed.scope.entry || state.scope.entry;
  state.scope.limits = seed.scope.limits || state.scope.limits;
  state.scope.parent = seed.scope.parent || state.scope.parent;
  if (args.answer) {
    state.blocker.answer = args.answer;
    state.blocker.kind = "none";
  }
  const decision = route(spec, toGateRecord(state));
  remember(args.repo, readme, state.scope.parent);
  if (args.command === "status") {
    console.log(`parent: ${state.scope.parent}`);
    console.log(`stage: ${state.stage}`);
    console.log(`next: ${decision.edge} → ${decision.to}${decision.assignment ? ` (${decision.assignment})` : ""}`);
    console.log(`writer: ${state.writer}`);
    console.log(`resume: ${decision.question || state.resume || decision.edge}`);
    if (loaded.legacy) console.log("note: legacy Autopilot section was not a graph checkpoint; status did not rewrite it");
    return;
  }
  const host = await connectOpenCode();
  const compiled = compileGraph({ spec, host, repo: args.repo });
  const finalState = await invokeGraph(compiled, state, `${state.scope.parent}:${readme}`);
  const after = readCheckpoint(readme).state ?? finalState;
  if (after.stage === "complete") {
    console.log(`complete: ${after.scope.parent}`);
    return;
  }
  if (after.blocker.kind !== "none") {
    console.log(`blocked: ${after.blocker.kind}`);
    console.log(after.blocker.question);
    console.log("Resume with: agents-kit resume --repo <path> --answer \"<the answer>\"");
    process.exitCode = 2;
    return;
  }
  console.log(`stopped at ${after.stage}: ${after.resume}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
