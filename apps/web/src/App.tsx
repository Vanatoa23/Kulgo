import { HealthResponseSchema, type HealthResponse } from "@kulgo/shared";
import { Globe2, ShieldCheck, Activity, Layers } from "lucide-react";
import { useEffect, useState } from "react";

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/health")
      .then(async (res) => {
        const json = await res.json();
        const parsed = HealthResponseSchema.safeParse(json);
        if (!active) return;
        if (parsed.success) {
          setHealth(parsed.data);
          setApiError(null);
        } else {
          setApiError("Unexpected health payload");
        }
      })
      .catch(() => {
        if (active) setApiError("API offline — start @kulgo/api to connect");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Globe2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Kulgo</h1>
            <p className="text-xs text-slate-400">
              Privacy-first supply chain mapping &amp; resilience
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900">
          <span
            className={`h-2 w-2 rounded-full ${
              health?.status === "ok"
                ? "bg-emerald-400"
                : health?.status === "degraded"
                  ? "bg-amber-400"
                  : "bg-slate-500"
            }`}
          />
          {health
            ? `API ${health.status.toUpperCase()} · ArcadeDB ${
                health.database.connected ? "Connected" : "Offline"
              }`
            : (apiError ?? "Checking API...")}
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-12 space-y-8">
        <section className="space-y-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
            Milestone 0 · Foundation Active
          </span>
          <h2 className="text-3xl font-semibold tracking-tight text-white">
            Radical visibility without exposing partner networks.
          </h2>
          <p className="text-slate-400 max-w-2xl leading-relaxed">
            Kulgo lets companies map their suppliers, volume splits, and
            contracts on a global map while computing hidden Tier-2+ risk,
            sanctions exposure, and ESG emissions strictly server-side.
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <h3 className="font-medium text-slate-100">
              Strict Tier-2+ Privacy Wall
            </h3>
            <p className="text-sm text-slate-400">
              ArcadeDB runs isolated on a private network. Strict Zod contracts
              and automated boundary tests prevent cross-tenant leakage.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-2">
            <Activity className="h-5 w-5 text-amber-400" />
            <h3 className="font-medium text-slate-100">
              Green / Yellow / Red Corridors
            </h3>
            <p className="text-sm text-slate-400">
              Next up in M1: 60fps MapLibre + Deck.gl map with HQ-to-site
              refinement, volume splits, and Estonia Product X demo mode.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-2">
            <Layers className="h-5 w-5 text-sky-400" />
            <h3 className="font-medium text-slate-100">
              Pure Risk &amp; ESG Engine
            </h3>
            <p className="text-sm text-slate-400">
              Deterministic HHI, SPOF, and Scope 1/2/3 roll-ups live in{" "}
              <code className="text-slate-200">@kulgo/engine</code> with
              fail-closed confidence badges.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
