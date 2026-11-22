import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { createContract } from "./api.js";

export interface PendingContractSave {
  request: Parameters<typeof createContract>[0];
  saving: boolean;
  conflict?: boolean;
  confirmed?: boolean;
  error?: string;
}

const PendingSavesContext = createContext<{
  saves: ReadonlyMap<string, PendingContractSave>;
  set: (laneId: string, save: PendingContractSave | null) => void;
} | null>(null);

// Account-scoped owner above page, inspector, and route views.
export function PendingContractSavesProvider({ children }: { children: ReactNode }) {
  const [saves, setSaves] = useState<ReadonlyMap<string, PendingContractSave>>(() => new Map());
  const set = useCallback((laneId: string, save: PendingContractSave | null) => {
    setSaves((previous) => {
      const next = new Map(previous);
      if (save) next.set(laneId, save);
      else next.delete(laneId);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ saves, set }), [saves, set]);
  return <PendingSavesContext.Provider value={value}>{children}</PendingSavesContext.Provider>;
}

export function usePendingContractSave(laneId: string) {
  const context = useContext(PendingSavesContext);
  if (!context) throw new Error("Pending contract saves require an account provider");
  const setPending = useCallback((save: PendingContractSave | null) => context.set(laneId, save), [context.set, laneId]);
  return { pending: context.saves.get(laneId), setPending };
}
