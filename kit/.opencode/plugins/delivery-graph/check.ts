import fs from "node:fs"
import path from "node:path"

const HEADING = "## Autopilot"

export function checkpointAllows(markdown: string, agent: string): boolean {
  const start = markdown.indexOf(HEADING)
  if (start < 0 || !agent) return false
  const rest = markdown.slice(start + HEADING.length)
  const next = rest.search(/\n## /)
  const section = next < 0 ? rest : rest.slice(0, next)
  const fence = section.match(/```yaml\n([\s\S]*?)```/)?.[1]
  if (!fence || !/^version:\s*1\s*$/m.test(fence)) return false
  const role = fence.match(/^\s*role:\s*(\S+)\s*$/m)?.[1]
  const status = fence.match(/^\s*status:\s*(\S+)\s*$/m)?.[1]
  return role === agent && (status === "pending" || status === "running")
}

export function findAllowingReadme(root: string, agent: string): string | null {
  const stories = path.join(root, "docs", "stories")
  if (!fs.existsSync(stories)) return null
  const stack = [stories]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && entry.name === "README.md" && checkpointAllows(fs.readFileSync(full, "utf8"), agent)) {
        return full
      }
    }
  }
  return null
}

export function rejection(agent: string): string {
  return [
    `Autopilot cannot dispatch ${agent || "a specialist"} until the parent README has a version 1 Autopilot checkpoint for that role.`,
    "Write only the ## Autopilot section, with status pending, then retry the spawn. Do not write the story yourself.",
    "```yaml",
    "version: 1",
    "stage: plan",
    "active_dispatch:",
    `  role: ${agent || "<specialist>"}`,
    "  status: pending",
    "  name: <unique task name>",
    "  assignment: <graph assignment>",
    "```",
  ].join("\n")
}
