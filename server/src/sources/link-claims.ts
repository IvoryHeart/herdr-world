import type {
  FieldClaim,
  LinkClaimSubject,
  LinkClaimProjection,
} from "../../../shared/fieldClaims";
import { FieldClaims } from "../world/field-claims";

type Entry = { subject: LinkClaimSubject; claims: FieldClaims<string> };

/** Runtime read model only. Link evidence never selects a target for a PR verb. */
export class LinkClaims {
  #entries = new Map<string, Entry>();
  #key(subject: Pick<LinkClaimSubject, "connectionId" | "paneId">) {
    return JSON.stringify([subject.connectionId, subject.paneId]);
  }
  observe(
    subject: LinkClaimSubject,
    reported: FieldClaim<string> | null,
    branch: FieldClaim<string> | null | undefined,
  ) {
    const key = this.#key(subject),
      previous = this.#entries.get(key);
    const sameRuntimeTerminal =
      previous &&
      subject.terminalId !== null &&
      previous.subject.connectionId === subject.connectionId &&
      previous.subject.generation === subject.generation &&
      previous.subject.terminalId === subject.terminalId;
    // Missing evidence retains a witness only within the same runtime and terminal.
    subject = {
      ...subject,
      sessionFingerprint:
        subject.sessionFingerprint ??
        (sameRuntimeTerminal ? previous.subject.sessionFingerprint : null) ??
        null,
    };
    const entry =
      previous && JSON.stringify(previous.subject) === JSON.stringify(subject)
        ? previous
        : {
            subject: structuredClone(subject),
            claims: new FieldClaims<string>(),
          };
    entry.claims.observe("herdr.metadata", reported ?? undefined, true);
    if (branch !== undefined)
      entry.claims.observe("world.checkout", branch ?? undefined, true);
    this.#entries.set(key, entry);
  }
  reconcileRuntimes(
    owners: readonly { connection_id: string; generation: number }[],
  ) {
    const current = new Map(
      owners.map((owner) => [owner.connection_id, owner.generation]),
    );
    for (const [key, entry] of this.#entries)
      if (current.get(entry.subject.connectionId) !== entry.subject.generation)
        this.#entries.delete(key);
  }
  completePanes(
    connectionId: string,
    generation: number,
    panes: ReadonlySet<string>,
  ) {
    for (const [key, entry] of this.#entries)
      if (
        entry.subject.connectionId === connectionId &&
        (entry.subject.generation !== generation ||
          !panes.has(entry.subject.paneId))
      )
        this.#entries.delete(key);
  }
  fork(): LinkClaims {
    const copy = new LinkClaims();
    for (const [key, entry] of this.#entries) {
      const claims = new FieldClaims<string>();
      for (const claim of entry.claims.values())
        claims.observe(claim.source, claim, false);
      copy.#entries.set(key, {
        subject: structuredClone(entry.subject),
        claims,
      });
    }
    return copy;
  }
  values(): LinkClaimProjection[] {
    return [...this.#entries.values()].map(({ subject, claims }) => ({
      ...structuredClone(subject),
      pr_links: claims.project("pr_links"),
    }));
  }
}
