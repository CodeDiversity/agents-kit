import fs from "node:fs";
import path from "node:path";
import { edgeOrderFromProse, loadSpec } from "./spec.js";

// lint-kit: static integrity checks for the kit sources (no target repo).
//   cd runner && npm run lint-kit
// Exits 1 on any finding. Root is resolved from this file: runner/src/../..

// Write targets the graph contract may declare. Docs-only work targets
// docs/ or artifacts/; the reviewer reports and the implementer's single
// application root are the sanctioned exceptions.
const WRITE_ALLOWED = (token: string): boolean =>
  token === "application" ||
  token === "walkthrough.md" ||
  token === "review.md" ||
  token === "plan-review.md" ||
  token.startsWith("docs/") ||
  token.startsWith("artifacts/");

const MARKDOWN_LINK = /\]\(([^)#\s]+\.md)\)/g;
const SKILL_PATH = /(?:\.agents\/)?skills\/([a-z0-9-]+)\/SKILL\.md|\.\.\/([a-z0-9-]+)\/SKILL\.md/g;

function listFiles(root: string, dir: string): string[] {
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) return [];
  const walk = (node: string, rel: string): string[] =>
    path.extname(node) === "" && fs.statSync(node).isDirectory()
      ? fs.readdirSync(node).flatMap((name) => walk(path.join(node, name), path.join(rel, name)))
      : [rel];
  const walking = fs.readdirSync(base).flatMap((name) => walk(path.join(base, name), path.join(dir, name)));
  return walking.filter((rel) => rel.endsWith(".md"));
}

function rosterFrom(host: "codex" | "vibe" | "opencode", kitRoot: string): Map<string, string> {
  const dir = path.join(kitRoot, `.${host}`, "agents");
  const roster = new Map<string, string>();
  if (!fs.existsSync(dir)) return roster;
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (!fs.statSync(full).isFile()) continue;
    if (host === "codex") {
      // Codex keys the roster on name; fall back to the filename.
      const match = fs.readFileSync(full, "utf8").match(/^name *= *"([^"]+)" *$/m);
      roster.set(match?.[1] ?? file.replace(/\.toml$/, ""), full);
      continue;
    }
    // Vibe identity is the .toml filename (display_name is user-facing);
    // OpenCode identity is the .md filename.
    roster.set(file.replace(/\.(toml|md)$/, ""), full);
  }
  return roster;
}

export function lintKit(root: string): string[] {
  const kit = path.join(root, "kit");
  const templates = path.join(root, "templates");
  const graphRel = path.join("kit", ".agents", "workflow-graph.md");
  const graphPath = path.join(kit, ".agents", "workflow-graph.md");
  const skillsRoot = path.join(kit, ".agents", "skills");

  const findings: string[] = [];
  const add = (file: string, message: string) => findings.push(`${file}: ${message}`);

  // 1. Workflow graph contract: fence parses; prose tables agree; targets,
  //    interrupts and non-edge references resolve to declared ids; writes
  //    stay on the sanctioned surface.
  if (!fs.existsSync(graphPath)) {
    add(graphRel, "missing workflow-graph.md");
  } else {
    const markdown = fs.readFileSync(graphPath, "utf8");
    let spec;
    try {
      spec = loadSpec(markdown);
    } catch (error) {
      add(graphRel, `graph contract fence invalid: ${(error as Error).message}`);
      spec = null;
    }
    if (spec) {
      const prose = edgeOrderFromProse(markdown);
      const yaml = spec.edges.map((edge) => edge.id);
      if (prose.join("\n") !== yaml.join("\n")) {
        add(graphRel, "prose edge table does not match YAML fence edges");
      }
      const interruptIds = spec.interrupts.map((entry) => entry.id);
      if (new Set(interruptIds).size !== interruptIds.length) {
        add(graphRel, "interrupt ids are duplicated in the fence");
      }
      const knownInterrupts = new Set(interruptIds);
      // `recorded` is a sanctioned sentinel, not a declared interrupt: it stops
      // on an already-recorded blocker tuple rather than opening a new one.
      for (const edge of spec.edges) {
        if (edge.interrupt && edge.interrupt !== "recorded" && !knownInterrupts.has(edge.interrupt)) {
          add(graphRel, `edge ${edge.id} uses undeclared interrupt ${edge.interrupt}`);
        }
        if (edge.interrupt && !edge.question?.trim()) {
          add(graphRel, `interrupted edge ${edge.id} must record its question`);
        }
      }
      const interruptsSection = markdown.split("## Interrupts")[1]?.split("## ")[0] ?? "";
      if (!interruptsSection) {
        add(graphRel, "workflow-graph.md has no Interrupts section");
      } else {
        const declared = new Set(
          [...interruptsSection.matchAll(/^\| ([a-z_]+) \|/gm)]
            .map((match) => match?.[1] ?? "")
            .filter((id) => id && id !== "interrupt"),
        );
        if ([...declared].sort().join() !== [...knownInterrupts].sort().join()) {
          add(graphRel, "prose interrupt table does not match YAML interrupts");
        }
      }
      const nodeIds = new Set(spec.nodes.map((node) => node.id));
      for (const nonEdge of spec.non_edges) {
        for (const never of nonEdge.never ?? []) {
          if (!nodeIds.has(never)) add(graphRel, `non_edge ${nonEdge.id} never-lists unknown node ${never}`);
        }
        if (nonEdge.expect && !nodeIds.has(nonEdge.expect)) {
          add(graphRel, `non_edge ${nonEdge.id} expects unknown node ${nonEdge.expect}`);
        }
      }
      for (const node of spec.nodes) {
        const writes = node.writes ?? [];
        if (node.commit === "none" && writes.length > 0) {
          add(graphRel, `node ${node.id} commits none but declares writes`);
        }
        if (node.commit && node.commit !== "none" && writes.length === 0) {
          add(graphRel, `node ${node.id} commits ${node.commit} with no declared writes`);
        }
        for (const token of writes) {
          if (!WRITE_ALLOWED(token)) {
            add(graphRel, `node ${node.id} writes outside the sanctioned surface: ${token}`);
          }
        }
      }
    }
  }

  // 2. Host roster parity; every non-`none` graph role exists in each host.
  const rosters = {
    codex: rosterFrom("codex", kit),
    vibe: rosterFrom("vibe", kit),
    opencode: rosterFrom("opencode", kit),
  };
  const base = [...rosters.codex.keys()].sort();
  const sorted = (roster: Map<string, string>) => [...roster.keys()].sort();
  for (const host of ["vibe", "opencode"] as const) {
    const other = sorted(rosters[host]);
    if (other.length === 0) {
      add(`.${host}/agents`, "no agent roster");
    } else if (base.length && other.join() !== base.join()) {
      add(`.${host}/agents`, `roster drift: ${host} = ${other.join()} vs codex = ${base.join()}`);
    }
  }
  if (base.length === 0) add(".codex/agents", "no agent roster");
  try {
    const spec = loadSpec(fs.readFileSync(graphPath, "utf8"));
    for (const node of spec.nodes) {
      if (!node.role || node.role === "none") continue;
      for (const [host, roster] of Object.entries(rosters)) {
        if (roster.size > 0 && !roster.has(node.role)) {
          add(`.${host}/agents`, `graph node ${node.id} needs role ${node.role}; host ${host} lacks it`);
        }
      }
    }
  } catch {
    // check 1 reports spec failures; avoid a duplicate here.
  }

  // 3. Skills self-describe and all references exist.
  for (const rel of listFiles(kit, ".agents/skills")) {
    const dir = path.basename(path.dirname(rel));
    const front = fs.readFileSync(path.join(kit, rel), "utf8").match(/^name: ([a-z0-9-]+)$/m)?.[1];
    if (front !== dir) add(rel, `skill name ${front} does not match directory ${dir}`);
  }
  for (const source of [
    { root: kit, files: listFiles(kit, ".") },
    { root: templates, files: listFiles(templates, ".") },
  ]) {
    for (const rel of source.files) {
      const text = fs.readFileSync(path.join(source.root, rel), "utf8");
      for (const match of [...text.matchAll(SKILL_PATH)]) {
        const name = match?.[1] ?? match?.[2] ?? "";
        if (!fs.existsSync(path.join(skillsRoot, name, "SKILL.md"))) {
          add(rel, `dangling skill reference: ${name}`);
        }
      }
      for (const match of [...text.matchAll(MARKDOWN_LINK)]) {
        const target = match?.[1] ?? "";
        if (path.isAbsolute(target) || target.startsWith("http")) continue;
        // links into docs/ target the installed repo, not the kit sources
        if (target.split("/").includes("docs")) continue;
        if (source.root === templates && !target.includes(".agents/")) continue;
        if (source.root === kit && target.startsWith(".agents/")) {
          // root-relative installed-repo links stay valid within the kit.
          if (!fs.existsSync(path.join(kit, target))) {
            add(rel, `dangling link: ${target}`);
          }
          continue;
        }
        const resolved = path.resolve(path.dirname(path.join(source.root, rel)), target);
        if (path.relative(kit, resolved).startsWith("..")) continue;
        if (!fs.existsSync(resolved)) add(rel, `dangling link: ${target}`);
      }
    }
  }

  // 4. Installer manifest exposes the project name default.
  const manifestPath = path.join(kit, "kit.toml");
  if (!fs.existsSync(manifestPath)) {
    add("kit/kit.toml", "missing kit manifest");
  } else {
    const toml = fs.readFileSync(manifestPath, "utf8");
    if (!/^\[project\]/m.test(toml) || !/^name *= *"[^"]+"/m.test(toml)) {
      add("kit/kit.toml", "manifest needs [project].name");
    }
  }
  return findings;
}

const invoked = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invoked) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  const findings = lintKit(root);
  if (findings.length > 0) {
    console.error(`kit lint: ${findings.length} finding(s)`);
    for (const message of findings) console.error(`- ${message}`);
    process.exit(1);
  }
  console.log("kit lint: OK");
}
