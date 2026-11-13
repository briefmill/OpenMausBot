export const BRAIN_PANEL_URL = "https://graphify-brain-production.up.railway.app/viewer";
export const BRAIN_VIEW_PATH = "/api/workspace/brain";
export const BRAIN_VIEW_SCOPES = ["bvs", "briefmill", "proxie", "innerclip", "coordinator"] as const;
export type BrainViewScope = typeof BRAIN_VIEW_SCOPES[number];
export const BRAIN_SCOPE_LABELS: Record<BrainViewScope, string> = { bvs: "BVS", briefmill: "Briefmill", proxie: "Proxie / ProxyScore", innerclip: "Inner Clip", coordinator: "Coordinator summaries" };
export interface BrainViewRecord { id: string; title: string; body: string; source: string; occurred_at: number | null; created: number }
export interface BrainView { scope: BrainViewScope; records: BrainViewRecord[]; limit: number; fetchedAt: number }
export interface BrainGraphView { scope: BrainViewScope; html: string; recordCount: number; nodes: number; edges: number; basis: string; fetchedAt: number }
