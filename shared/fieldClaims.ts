/** Runtime evidence about one field, never a World record ID or an action target. */
export type FieldClaim<T> = {
  value: T;
  source: string;
  author?: string;
  observed_at: number;
  basis: "reported" | "inferred";
  source_revision?: string | number;
};
export type ClaimedField<T> = {
  claims: FieldClaim<T>[];
  display: FieldClaim<T>[];
};
export type NativeSessionClaim = {
  source: string;
  agent: string;
  kind: string;
  value: string;
};
export type AgentFieldClaims = {
  agent_status: ClaimedField<string>;
  session: ClaimedField<NativeSessionClaim>;
};
export type ClaimField = "agent_status" | "pr_links" | "session";

export type LinkClaimSubject = {
  connectionId: string;
  generation: number;
  paneId: string;
  terminalId: string | null;
  sessionFingerprint: string | null;
};
export type LinkClaimProjection = LinkClaimSubject & {
  pr_links: ClaimedField<string>;
};
