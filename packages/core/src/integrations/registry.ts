import type { ProviderId } from "../types";
import type { IntegrationModule } from "./contract";

export class Registry {
  private mods = new Map<ProviderId, IntegrationModule>();
  constructor(modules: IntegrationModule[]) { for (const m of modules) this.mods.set(m.id, m); }
  get(id: string): IntegrationModule | undefined { return this.mods.get(id as ProviderId); }
  list(): IntegrationModule[] { return [...this.mods.values()]; }
}
