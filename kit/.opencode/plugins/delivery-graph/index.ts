import { Plugin } from "@opencode/plugin"
import { findAllowingReadme, rejection } from "./check.ts"

export default Plugin.define({
  id: "delivery-graph",
  async setup(ctx) {
    await ctx.tool.hook("execute.before", async (event) => {
      if (event.agent !== "autopilot" || event.tool !== "subagent") return
      const child = childAgent(event.input)
      const session = await ctx.session.get({ sessionID: event.sessionID })
      const directory = session.directory || ctx.location.directory
      if (!findAllowingReadme(directory, child)) {
        throw new Error(rejection(child))
      }
    })
  },
})

function childAgent(input: unknown): string {
  if (!input || typeof input !== "object") return ""
  const record = input as Record<string, unknown>
  const value = record.agent ?? record.agent_type
  return typeof value === "string" ? value : ""
}
