import type {
  ClaimedField,
  ClaimField,
  FieldClaim,
} from "../../../shared/fieldClaims";

/** Each channel owns its claim. Partial silence has no deletion meaning. */
export class FieldClaims<T> {
  #claims = new Map<string, FieldClaim<T>>();
  observe(source: string, claim: FieldClaim<T> | undefined, complete: boolean) {
    if (claim && claim.source !== source)
      throw new Error("Claim source does not own this observation");
    if (claim) this.#claims.set(source, structuredClone(claim));
    else if (complete) this.#claims.delete(source);
  }
  retract(source: string) {
    this.#claims.delete(source);
  }
  values(): FieldClaim<T>[] {
    return structuredClone(
      [...this.#claims.values()].sort((a, b) =>
        a.source.localeCompare(b.source),
      ),
    );
  }
  project(field: ClaimField): ClaimedField<T> {
    const claims = this.values();
    return { claims, display: displayClaims(field, claims) };
  }
}

export const fieldClaimPolicies = {
  agent_status: {
    sources: ["herdr.agent", "world.transcript"],
    display: "first",
    authority: {},
  },
  pr_links: {
    sources: ["herdr.metadata", "world.checkout"],
    display: "all",
    authority: {},
  },
  session: {
    sources: ["herdr.title", "herdr.agent", "world.transcript"],
    display: "first",
    authority: {
      "conversation.send": ["herdr.agent", "herdr.title"],
      "board.send": ["herdr.agent"],
      "ask.answer": ["herdr.agent"],
    },
  },
} as const;

export function displayClaims<T>(
  field: ClaimField,
  claims: readonly FieldClaim<T>[],
): FieldClaim<T>[] {
  const policy = fieldClaimPolicies[field];
  const ordered = policy.sources.flatMap((source) =>
    claims.filter((claim) => claim.source === source),
  );
  return structuredClone(
    policy.display === "all" ? ordered : ordered.slice(0, 1),
  );
}

/** Only for a fresh native read; a stored projection is never a freshness proof. */
export function claimAuthorizes(
  field: ClaimField,
  verb: string,
  claim: FieldClaim<unknown>,
): boolean {
  const authority: Readonly<Record<string, readonly string[]>> =
    fieldClaimPolicies[field].authority;
  return (
    claim.basis === "reported" &&
    Boolean(authority[verb]?.includes(claim.source))
  );
}
