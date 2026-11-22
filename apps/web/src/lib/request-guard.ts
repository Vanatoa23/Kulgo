/**
 * Latest-wins guard for async loads. Each `begin()` supersedes earlier
 * tickets; `invalidate()` (call on login/logout/account change) rejects every
 * ticket issued so far. Only a ticket where `isCurrent()` is true may commit
 * its result to state.
 */
export interface RequestTicket {
  isCurrent(): boolean;
}

export interface RequestGuard {
  begin(): RequestTicket;
  /** Ticket for the current generation without superseding earlier tickets. */
  capture(): RequestTicket;
  invalidate(): void;
}

export function createRequestGuard(): RequestGuard {
  let generation = 0;
  return {
    begin() {
      const mine = ++generation;
      return { isCurrent: () => mine === generation };
    },
    capture() {
      const mine = generation;
      return { isCurrent: () => mine === generation };
    },
    invalidate() {
      generation += 1;
    },
  };
}
