import type { SpecialistReturn } from "../types.js";
import type { Tri } from "../types.js";

export interface DispatchInput {
  role: string;
  taskName: string;
  handoff: string;
  workspace: string;
  readOnly: boolean;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface HostAdapter {
  id: string;
  dispatch(input: DispatchInput): Promise<SpecialistReturn>;
  sessionLive(sessionId: string): Promise<Tri>;
  wait(sessionId: string, signal?: AbortSignal): Promise<SpecialistReturn>;
}
