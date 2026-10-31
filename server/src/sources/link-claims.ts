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
    // Missing native session evidence is silence, not evidence of a new occupant.
    subject = {
      ...subject,
      sessionFingerprint:
        subject.sessionFingerprint ??
        previous?.subject.sessionFingerprint ??
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
