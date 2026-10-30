import fs from "node:fs";
import path from "node:path";
import { MemorySaver } from "@langchain/langgraph-checkpoint";

// File-backed checkpointer: persists MemorySaver's in-memory storage to a JSON
// file after every put/putWrites/deleteThread, so a crashed runner process
// can resume from disk instead of losing the LangGraph thread state.
export class FileMemorySaver extends MemorySaver {
  private readonly file: string;
  private loaded = false;

  constructor(file: string) {
    super();
    this.file = file;
    this.load();
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!fs.existsSync(this.file)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as {
        storage?: Record<string, unknown>;
        writes?: Record<string, unknown>;
      };
      if (raw.storage) (this as unknown as { storage: unknown }).storage = hydrate(raw.storage);
      if (raw.writes) (this as unknown as { writes: unknown }).writes = hydrate(raw.writes);
    } catch {
      // Corrupt checkpoint file: ignore and start fresh; the README checkpoint
      // remains the durable human surface.
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const payload = JSON.stringify({
        storage: dehydrate((this as unknown as { storage: unknown }).storage),
        writes: dehydrate((this as unknown as { writes: unknown }).writes),
      });
      fs.writeFileSync(this.file, payload, "utf8");
    } catch {
      // Best-effort persistence; never break a run on a disk write failure.
    }
  }

  override async put(...args: Parameters<MemorySaver["put"]>): Promise<Awaited<ReturnType<MemorySaver["put"]>>> {
    const result = await super.put(...args);
    this.save();
    return result;
  }

  override async putWrites(...args: Parameters<MemorySaver["putWrites"]>): Promise<Awaited<ReturnType<MemorySaver["putWrites"]>>> {
    const result = await super.putWrites(...args);
    this.save();
    return result;
  }

  override async deleteThread(threadId: string): Promise<void> {
    await super.deleteThread(threadId);
    this.save();
  }
}

function dehydrate(value: unknown): unknown {
  if (value instanceof Uint8Array) return { __u8: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(dehydrate);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = dehydrate(val);
    }
    return out;
  }
  return value;
}

function hydrate(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.__u8 === "string") return new Uint8Array(Buffer.from(record.__u8, "base64"));
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(record)) out[key] = hydrate(val);
    return out;
  }
  if (Array.isArray(value)) return value.map(hydrate);
  return value;
}

export function checkpointerPath(repo: string, _threadId = "all"): string {
  return path.join(repo, ".agents", "runner", "checkpoints.json");
}