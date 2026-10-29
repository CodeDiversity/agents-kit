import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { parseCloseout } from "../closeout.js";
import type { SpecialistReturn, Tri } from "../types.js";
import type { DispatchInput, HostAdapter } from "./types.js";

interface AgentRow { id: string; name: string }
interface MessageRow {
  type: string;
  content?: Array<{ type: string; text?: string }>;
}
interface PermissionRow { id: string; action: string; resources: string[] }
interface FormRow { id: string; title: string }

export interface OpenCodeSessionClient {
  session: {
    create(input: { title?: string; agent?: string | null; location?: { directory: string } }): Promise<{ id: string }>;
    active(): Promise<Record<string, { type: string }>>;
    get(input: { sessionID: string }): Promise<{ id: string; time?: { idle?: number }; outcome?: string }>;
    prompt(input: { sessionID: string; text: string }): Promise<unknown>;
    form: { list(input: { sessionID: string }): Promise<FormRow[]> };
  };
  experimental: { session: { wait(input: { sessionID: string }, opts?: { signal?: AbortSignal }): Promise<void> } };
  message: { list(input: { sessionID: string; limit?: number; order?: "asc" | "desc" }): Promise<{ data: MessageRow[] }> };
  permission: { list(input: { sessionID: string }): Promise<PermissionRow[]> };
  agent: { list(input?: { location?: { directory: string } }): Promise<{ data: AgentRow[] }> };
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 2000;

export async function connectOpenCode(): Promise<HostAdapter> {
  const endpoint = await Service.discover();
  if (!endpoint) {
    throw new Error("No local OpenCode service is running. Start OpenCode, then retry. This runner does not start a second host.");
  }
  const client = OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(endpoint),
  });
  return new OpenCodeHost(client as unknown as OpenCodeSessionClient);
}

export class OpenCodeHost implements HostAdapter {
  id = "opencode";

  constructor(
    private readonly client: OpenCodeSessionClient,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly pollMs = DEFAULT_POLL_MS,
  ) {}

  async sessionLive(sessionId: string): Promise<Tri> {
    if (!sessionId) return false;
    try {
      const active = await this.client.session.active();
      if (active[sessionId]?.type === "running") return true;
      const info = await this.client.session.get({ sessionID: sessionId });
      if (info.time?.idle || info.outcome) return false;
      return false;
    } catch {
      return "unknown";
    }
  }

  async dispatch(input: DispatchInput): Promise<SpecialistReturn> {
    const agents = await this.client.agent.list({ location: { directory: input.workspace } });
    const known = new Set(agents.data.flatMap((agent) => [agent.id, agent.name]));
    const agent = known.has(input.role) ? input.role : null;
    if (!agent && !input.readOnly) {
      throw new Error(`OpenCode has no "${input.role}" agent in ${input.workspace}. Install the kit before dispatching.`);
    }
    const session = await this.client.session.create({
      title: input.taskName,
      agent,
      location: { directory: input.workspace },
    });
    await this.client.session.prompt({ sessionID: session.id, text: input.handoff });
    return this.finish(session.id, input.signal);
  }

  async wait(sessionId: string, signal?: AbortSignal): Promise<SpecialistReturn> {
    return this.finish(sessionId, signal);
  }

  private async finish(sessionId: string, signal?: AbortSignal): Promise<SpecialistReturn> {
    const paused = await this.pauseReason(sessionId);
    if (paused) return pausedReturn(sessionId, paused);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      await this.client.experimental.session.wait({ sessionID: sessionId }, { signal: abort });
    } catch {
      await this.pollUntilIdle(sessionId, abort);
    }
    const after = await this.pauseReason(sessionId);
    if (after) return pausedReturn(sessionId, after);
    const messages = await this.client.message.list({ sessionID: sessionId, limit: 20, order: "desc" });
    const text = assistantText(messages.data);
    return parseCloseout(text, sessionId);
  }

  private async pollUntilIdle(sessionId: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const paused = await this.pauseReason(sessionId);
      if (paused) return;
      const info = await this.client.session.get({ sessionID: sessionId });
      if (info.time?.idle || info.outcome) return;
      const active = await this.client.session.active();
      if (!active[sessionId]) return;
      await delay(this.pollMs, signal);
    }
  }

  private async pauseReason(sessionId: string): Promise<{ kind: string; question: string } | null> {
    const permissions = await this.client.permission.list({ sessionID: sessionId });
    if (permissions.length > 0) {
      const first = permissions[0];
      return {
        kind: "missing_permission",
        question: `OpenCode is asking permission for ${first?.action ?? "a tool"} on ${(first?.resources ?? []).join(", ") || "a resource"}. The runner will not approve it.`,
      };
    }
    const forms = await this.client.session.form.list({ sessionID: sessionId });
    if (forms.length > 0) {
      return {
        kind: "material_decision",
        question: forms.map((form) => form.title).join("; ") || "The specialist asked a question.",
      };
    }
    return null;
  }
}

function pausedReturn(sessionId: string, paused: { kind: string; question: string }): SpecialistReturn {
  return {
    status: "blocked",
    records: "",
    commits: "",
    verification: "",
    remaining: paused.question,
    raw: "",
    sessionId,
    paused,
  };
}

function assistantText(messages: MessageRow[]): string {
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    const text = (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
    if (text.trim()) return text;
  }
  return "";
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
