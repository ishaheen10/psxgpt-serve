import type { SourcePreview } from "../types";
export interface Evidence {
  id: string;
  source: SourcePreview;
  text: string;
  retrievedAt: string;
}
export interface ResearchSection {
  id: string;
  title: string;
  question: string;
  status: "queued" | "running" | "complete" | "partial" | "failed";
  activity: string;
  coverage?: { status: "supported" | "partial" | "unsupported"; gap: string };
  markdown: string;
  sourceIds: string[];
  startedAt?: string;
  completedAt?: string;
}
export interface ResearchReport {
  version: 1;
  id: string;
  query: string;
  scope: string;
  revision: number;
  sections: ResearchSection[];
  evidence: Evidence[];
  selection?: unknown;
  events: Array<{
    sectionId: string;
    tool: string;
    arguments: unknown;
    at: string;
    count: number;
    error?: string;
    discovery?: unknown[];
  }>;
}
export type ResearchSummary = Omit<ResearchReport, "evidence" | "events">;
