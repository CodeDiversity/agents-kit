import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface CommitResult {
  status: "committed" | "pending" | "none";
  hash: string;
  reason: string;
}

const SECRET = /(^|\/)\.env($|\.)/i;

export function allowedCommitPath(role: string, relative: string): boolean {
  if (!relative || relative.startsWith("/") || relative.includes("..") || SECRET.test(relative)) return false;
  if (role === "refiner" || role === "ui-refiner") {
    return relative.startsWith("docs/stories/") && relative.endsWith(".md") && !relative.endsWith("README.md");
  }
  if (role === "reviewer") {
    return relative.endsWith("plan-review.md") || relative.endsWith("review.md") || relative.endsWith("walkthrough.md") || relative.endsWith("README.md");
  }
  return false;
}

export async function commitOwned(repo: string, role: string, paths: string[], message: string): Promise<CommitResult> {
  const unique = [...new Set(paths.map((item) => item.replaceAll("\\", "/")))].filter((item) => allowedCommitPath(role, item));
  if (unique.length === 0) return { status: "none", hash: "", reason: "no coordinator-owned paths in the closeout" };
  const status = await exec("git", ["status", "--porcelain"], { cwd: repo });
  const unrelatedStaged = status.stdout.split("\n").filter((line) => {
    if (line.length < 4 || line[0] === " " || line[0] === "?") return false;
    return !unique.includes(line.slice(3).trim());
  });
  if (unrelatedStaged.length > 0) {
    return { status: "pending", hash: "", reason: "unrelated staged work is present; coordinator will not stage or commit" };
  }
  await exec("git", ["add", "--", ...unique], { cwd: repo });
  const cached = await exec("git", ["diff", "--cached", "--name-only"], { cwd: repo });
  const names = cached.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (names.length === 0) return { status: "none", hash: "", reason: "nothing to commit" };
  if (names.some((name) => !unique.includes(name))) {
    return { status: "pending", hash: "", reason: "cached diff escaped the allowlist" };
  }
  try {
    await exec("git", ["commit", "-m", message], { cwd: repo });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "commit failed";
    return { status: "pending", hash: "", reason };
  }
  const head = await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: repo });
  return { status: "committed", hash: head.stdout.trim(), reason: path.basename(repo) };
}
