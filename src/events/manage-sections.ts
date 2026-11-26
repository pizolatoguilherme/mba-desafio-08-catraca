import type { EventRow } from './repo.js';

export type ManageSection = (ctx: { event: EventRow; organizerId: string }) => Promise<Record<string, unknown>>;

const sections = new Map<string, ManageSection>();

export function registerManageSection(name: string, fn: ManageSection): void {
  sections.set(name, fn);
}
