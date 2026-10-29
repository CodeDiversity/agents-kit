import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { emptyState, readCheckpoint } from "./checkpoint.js";
import type { DeliveryState, QueueRow, Tri } from "./types.js";

const exec = promisify(execFile);
const TERMINAL = new Set(["Reviewed", "Implemented — awaiting parent review"]);

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function normalizeState(value: string): string {
  return value.replace(/\s+[-–—]\s+/g, " — ").trim();
}

export function parseQueue(markdown: string): { rows: QueueRow[]; hash: string; active: string; artifactRoot: string } {
  const section = markdown.split(/## Execution queue/i)[1]?.split(/\n## /)[0] ?? markdown;
  const lines = section.split("\n").filter((line) => line.trim().startsWith("|"));
  const rows: QueueRow[] = [];
  for (const line of lines) {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (/^story$/i.test(cells[0] ?? "")) continue;
    if ((cells[0] ?? "").replace(/-/g, "") === "") continue;
    rows.push({
      story: cells[0] ?? "",
      state: normalizeState(cells[1] ?? ""),
      dependencies: cells[2] ?? "",
      nextAction: cells[3] ?? "",
      evidence: cells[4] ?? "",
    });
  }
  return {
    rows,
    hash: hashText(rows.map((row) => `${row.story}|${row.state}|${row.dependencies}`).join("\n")),
    active: field(markdown, "Active substory"),
    artifactRoot: field(markdown, "Artifact root"),
  };
}

function field(markdown: string, label: string): string {
  const match = markdown.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`, "i"))
    ?? markdown.match(new RegExp(`^${label}:\\s*([^\\n]+)`, "im"));
  return match?.[1]?.trim() ?? "";
}

export function dependenciesMet(row: QueueRow, rows: QueueRow[]): boolean | "unknown" {
  const cell = row.dependencies.trim();
  if (cell === "" || /^(none|-|n\/a)$/i.test(cell)) return true;
  const ids = cell.match(/\b[A-Z][A-Z0-9]*-\d+[A-Z]?\b/g);
  if (!ids || ids.length === 0) return "unknown";
  return ids.every((id) => {
    const dep = rows.find((item) => item.story === id);
    return dep ? TERMINAL.has(dep.state) : false;
  });
}

export function selectEligible(rows: QueueRow[]): QueueRow | null | "unknown" {
  const open = rows.filter((row) => !TERMINAL.has(row.state));
  if (open.length === 0) return null;
  const decided = open.map((row) => ({ row, deps: dependenciesMet(row, rows) }));
  if (decided.some((item) => item.deps === "unknown")) return "unknown";
  const ready = decided.find((item) => item.deps === true && item.row.state !== "Blocked");
  const blocked = decided.find((item) => item.deps === true && item.row.state === "Blocked");
  if (ready && blocked) {
    const dependsOnBlocked = new RegExp(`\\b${blocked.row.story}\\b`).test(ready.row.dependencies);
    if (!dependsOnBlocked) return ready.row;
  }
  return decided.find((item) => item.deps === true)?.row ?? null;
}

export async function gitFacts(repo: string): Promise<{ branch: string; head: string; dirty: string[] }> {
  try {
    const [branch, head, status] = await Promise.all([
      exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo }),
      exec("git", ["rev-parse", "HEAD"], { cwd: repo }),
      exec("git", ["status", "--porcelain"], { cwd: repo }),
    ]);
    return {
      branch: branch.stdout.trim(),
      head: head.stdout.trim(),
      dirty: status.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
    };
  } catch {
    return { branch: "unknown", head: "unknown", dirty: [] };
  }
}

export function fileExists(repo: string, relative: string): boolean {
  if (!relative || relative.includes("..")) return false;
  return fs.existsSync(path.join(repo, relative));
}

export interface ReconcileInput {
  repo: string;
  readmePath: string;
  sessionLive?: Tri;
}

export async function reconcile(input: ReconcileInput): Promise<DeliveryState> {
  const loaded = readCheckpoint(input.readmePath);
  const markdown = loaded.markdown;
  const prior = loaded.state;
  const queue = parseQueue(markdown);
  const git = await gitFacts(input.repo);
  const state = prior ?? emptyState({ readmePath: input.readmePath });
  state.readmePath = input.readmePath;
  state.coordinator.workspace = input.repo;
  state.coordinator.branch = git.branch;
  state.coordinator.head = git.head;
  if (!state.coordinator.baseline) state.coordinator.baseline = git.head;
  state.scope.parent = state.scope.parent || path.basename(path.dirname(input.readmePath));
  state.scope.descendants = queue.rows.map((row) => row.story);
  state.sessionLive = input.sessionLive ?? (state.activeDispatch.status === "running" ? "unknown" : false);

  const evidenceChanged = prior
    ? prior.gates.judgedAtHead !== git.head || prior.gates.queueHash !== queue.hash
    : true;
  if (evidenceChanged) {
    state.gates.judgedAtHead = "";
    state.gates.breakdown = "unknown";
    state.gates.plan = "unknown";
    state.gates.ui = "unknown";
    state.gates.refinement = "unknown";
    state.gates.childUnfinished = "unknown";
    state.gates.closeout = "unknown";
    state.gates.integration = "unknown";
    state.gates.allDescendantsImplemented = "unknown";
    state.gates.review = "unknown";
    state.gates.openFindings = "unknown";
    state.gates.findingsOwner = "unknown";
    state.gates.walkthrough = "unknown";
    state.judgmentAttempts = 0;
  }

  applyMechanical(state, input.repo, queue, markdown);
  if (state.blocker.answer.trim() && state.blocker.kind !== "none") {
    state.resume = `Settled answer recorded. Reconcile and take the next edge.`;
    state.blocker = { kind: "none", owner: "", question: "", answer: state.blocker.answer };
  }
  return state;
}

function applyMechanical(
  state: DeliveryState,
  repo: string,
  queue: ReturnType<typeof parseQueue>,
  markdown: string,
): void {
  const deliveryHome = path.dirname(state.readmePath);
  const parent = state.scope.parent;
  const artifactRoot = queue.artifactRoot || path.relative(repo, path.join(deliveryHome, "artifacts"));
  const planReview = path.join(deliveryHome, "plan-review.md");
  const review = path.join(repo, artifactRoot, parent, "review.md");
  const walkthrough = path.join(repo, artifactRoot, parent, "implementation-index-walkthrough.md");
  const walkthroughBeside = path.join(repo, artifactRoot, parent, "walkthrough.md");
  const index = path.join(repo, artifactRoot, parent, "implementation.md");

  if (queue.rows.length === 0 && !fs.existsSync(path.join(deliveryHome, `${parent}.md`)) && !/## Execution queue/i.test(markdown)) {
    state.gates.breakdown = false;
  }
  if (!fs.existsSync(planReview)) state.gates.plan = "missing";
  if (!fs.existsSync(review)) state.gates.review = "absent";
  if (!fs.existsSync(walkthroughBeside) && !fs.existsSync(walkthrough)) state.gates.walkthrough = "missing";

  const eligible = selectEligible(queue.rows);
  if (eligible === "unknown") {
    state.gates.eligibleChildState = "unknown";
  } else if (eligible === null) {
    state.gates.eligibleChildState = "none";
    state.gates.ui = false;
    state.gates.refinement = false;
  } else {
    state.gates.eligibleChildState = eligible.state;
    if (eligible.state === "Ready" || eligible.state === "In progress" || eligible.state === "Blocked") {
      state.gates.ui = false;
      state.gates.refinement = false;
    }
  }

  const inProgress = queue.rows.some((row) => row.state === "In progress");
  if (inProgress) state.gates.childUnfinished = true;

  if (queue.rows.length > 0 && queue.rows.every((row) => TERMINAL.has(row.state))) {
    const missingRecord = queue.rows.some((row) => !fs.existsSync(path.join(repo, artifactRoot, row.story, "implementation.md")));
    state.gates.allDescendantsImplemented = missingRecord ? false : true;
    if (!fs.existsSync(index)) state.gates.integration = false;
  } else if (queue.rows.length > 0) {
    state.gates.allDescendantsImplemented = false;
  }

  if (state.activeDispatch.status === "running") {
    if (state.sessionLive === true) state.writer = "held";
    else if (state.sessionLive === false) state.writer = "unknown";
    else state.writer = "unknown";
  } else if (state.activeDispatch.status === "none" || state.activeDispatch.status === "returned" || state.activeDispatch.status === "not_started") {
    state.writer = "none";
  }

  state.gates.queueHash = queue.hash;
}

export function judgmentUnknowns(state: DeliveryState): string[] {
  const gates = state.gates;
  const unknown: string[] = [];
  if (gates.breakdown === "unknown") unknown.push("breakdown_valid");
  if (gates.plan === "unknown") unknown.push("plan_approval");
  if (gates.ui === "unknown") unknown.push("needs_ui_refinement");
  if (gates.refinement === "unknown") unknown.push("needs_technical_refinement");
  if (gates.childUnfinished === "unknown") unknown.push("child_unfinished");
  if (gates.closeout === "unknown") unknown.push("closeout_complete");
  if (gates.integration === "unknown") unknown.push("integration_complete");
  if (gates.allDescendantsImplemented === "unknown") unknown.push("all_descendants_implemented");
  if (gates.review === "unknown") unknown.push("review");
  if (gates.openFindings === "unknown") unknown.push("open_findings");
  if (gates.findingsOwner === "unknown") unknown.push("findings_owner");
  if (gates.walkthrough === "unknown") unknown.push("walkthrough");
  if (state.lastResult.cycles >= 2 && state.lastResult.sameFindings === "unknown") unknown.push("same_findings");
  return unknown;
}
