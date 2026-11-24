import {
  EE_COMPANY_REGISTRY_SOURCE,
  type CompanyRegistrySearchInput,
  type CompanyRegistrySearchResponse,
} from "@kulgo/shared";

import { matchRegistry, type RegistrySearchResult } from "./matcher.js";
import {
  FileRegistrySnapshotStore,
  type RegistrySnapshotError,
  type SnapshotState,
} from "./snapshot.js";

export type { RegistrySnapshotError, SnapshotState };

/**
 * Server-side company registry search use case. Stateless per request and
 * scoped to public registry data only — it never receives or returns
 * tenant-specific information beyond the client's own search terms.
 */
export interface CompanyRegistrySearchService {
  search(input: CompanyRegistrySearchInput): Promise<CompanyRegistrySearchResponse>;
  /** Current snapshot state, for operators and tests. */
  snapshotState(): Promise<SnapshotState>;
}

export function createEeCompanyRegistrySearchService(
  snapshotPath: string,
  store: FileRegistrySnapshotStore = new FileRegistrySnapshotStore(snapshotPath),
): CompanyRegistrySearchService {
  return {
    async snapshotState() {
      return store.getSnapshot();
    },
    async search(input) {
      const snapshot = await store.getSnapshot();
      if (snapshot.kind !== "ok") {
        return {
          outcome: "SNAPSHOT_UNAVAILABLE",
          candidates: [],
          source: EE_COMPANY_REGISTRY_SOURCE,
        };
      }
      const result: RegistrySearchResult = matchRegistry(snapshot.index, {
        name: input.name,
        countryCode: input.countryCode ?? null,
        registryId: input.registryId ?? null,
      });
      return { ...result, source: EE_COMPANY_REGISTRY_SOURCE };
    },
  };
}
