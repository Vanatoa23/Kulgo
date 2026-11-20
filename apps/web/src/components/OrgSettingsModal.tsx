import type {
  Organization,
  UpdateOrganizationProfileInput,
} from "@kulgo/shared";
import {
  CheckCircle2,
  Leaf,
  Loader2,
  Plus,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { updateOrganizationProfile } from "../lib/api.js";

export interface OrgSettingsModalProps {
  open: boolean;
  organization: Organization;
  onClose: () => void;
  onUpdated: (organization: Organization) => void;
}

const PRESET_ESG_BADGES = [
  "ISO 14001",
  "EcoVadis Gold",
  "SBTi Committed",
  "RE100",
  "CSRD Ready",
  "ISO 50001",
];

function parseCommaList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

export function OrgSettingsModal({
  open,
  organization,
  onClose,
  onUpdated,
}: OrgSettingsModalProps) {
  const [scope1Text, setScope1Text] = useState("");
  const [scope2Text, setScope2Text] = useState("");
  const [esgBadges, setEsgBadges] = useState<string[]>([]);
  const [customBadge, setCustomBadge] = useState("");
  const [openToNewBuyers, setOpenToNewBuyers] = useState(false);
  const [capabilitiesText, setCapabilitiesText] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);

  useEffect(() => {
    if (!open) return;
    setScope1Text(
      organization.scope1Tco2e !== null ? String(organization.scope1Tco2e) : "",
    );
    setScope2Text(
      organization.scope2Tco2e !== null ? String(organization.scope2Tco2e) : "",
    );
    setEsgBadges(organization.esgBadges);
    setCustomBadge("");
    setOpenToNewBuyers(organization.openToNewBuyers);
    setCapabilitiesText(organization.capabilities.join(", "));
    setError(null);
    setSavedBanner(false);
  }, [open, organization]);

  if (!open) {
    return null;
  }

  const toggleBadge = (badge: string) => {
    setEsgBadges((prev) =>
      prev.includes(badge) ? prev.filter((b) => b !== badge) : [...prev, badge],
    );
  };

  const handleAddCustomBadge = () => {
    const trimmed = customBadge.trim();
    if (!trimmed) return;
    if (!esgBadges.includes(trimmed)) {
      setEsgBadges((prev) => [...prev, trimmed]);
    }
    setCustomBadge("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavedBanner(false);

    const parsedScope1 =
      scope1Text.trim() === "" ? null : Number(scope1Text.trim());
    const parsedScope2 =
      scope2Text.trim() === "" ? null : Number(scope2Text.trim());

    if (
      parsedScope1 !== null &&
      (!Number.isFinite(parsedScope1) || parsedScope1 < 0)
    ) {
      setError("Scope 1 emissions must be a non-negative number.");
      return;
    }
    if (
      parsedScope2 !== null &&
      (!Number.isFinite(parsedScope2) || parsedScope2 < 0)
    ) {
      setError("Scope 2 emissions must be a non-negative number.");
      return;
    }

    const payload: UpdateOrganizationProfileInput = {
      scope1Tco2e: parsedScope1,
      scope2Tco2e: parsedScope2,
      esgBadges,
      openToNewBuyers,
      capabilities: parseCommaList(capabilitiesText),
    };

    setSaving(true);
    try {
      const updated = await updateOrganizationProfile(payload);
      onUpdated(updated);
      setSavedBanner(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save organization settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="org-settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-xl max-h-[88vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-400">
              <Settings2 className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="org-settings-modal-title"
                className="text-sm font-semibold text-white"
              >
                Org ESG &amp; Directory Settings
              </h2>
              <p className="text-[11px] text-slate-400">
                {organization.name} ({organization.countryCode}) —{" "}
                {organization.sector}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close organization settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto p-5 space-y-5"
        >
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
              {error}
            </div>
          )}

          {savedBanner && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>
                Organization ESG &amp; directory settings saved. Analytics and
                CSRD report updated.
              </span>
            </div>
          )}

          {/* Scope 1 & 2 CO2e */}
          <section className="space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Leaf className="h-3.5 w-3.5 text-emerald-400" />
              <span>Annual Direct &amp; Energy Emissions (CSRD Scope 1 &amp; 2)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-400">
                  Scope 1 Emissions (tCO2e / yr)
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={scope1Text}
                  onChange={(e) => setScope1Text(e.target.value)}
                  placeholder="e.g. 420"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-400">
                  Scope 2 Emissions (tCO2e / yr)
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={scope2Text}
                  onChange={(e) => setScope2Text(e.target.value)}
                  placeholder="e.g. 185"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
                />
              </label>
            </div>
          </section>

          {/* ESG Badges */}
          <section className="space-y-2.5">
            <span className="block text-xs font-semibold text-slate-200">
              ESG Certifications &amp; Badges
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_ESG_BADGES.map((badge) => {
                const active = esgBadges.includes(badge);
                return (
                  <button
                    key={badge}
                    type="button"
                    onClick={() => toggleBadge(badge)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
                      active
                        ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200"
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {active ? "✓ " : "+ "}
                    {badge}
                  </button>
                );
              })}
              {esgBadges
                .filter((b) => !PRESET_ESG_BADGES.includes(b))
                .map((badge) => (
                  <button
                    key={badge}
                    type="button"
                    onClick={() => toggleBadge(badge)}
                    className="px-2.5 py-1 rounded-full text-[11px] font-medium border bg-emerald-500/20 border-emerald-500/50 text-emerald-200 cursor-pointer"
                  >
                    ✓ {badge} ×
                  </button>
                ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customBadge}
                onChange={(e) => setCustomBadge(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCustomBadge();
                  }
                }}
                placeholder="Add custom ESG badge (e.g. FSC Certified)..."
                className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCustomBadge}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add</span>
              </button>
            </div>
          </section>

          {/* Alternative Supplier Directory Opt-In */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={openToNewBuyers}
                onChange={(e) => setOpenToNewBuyers(e.target.checked)}
                className="mt-0.5 rounded border-slate-700 bg-slate-950 text-emerald-500"
              />
              <div className="space-y-0.5">
                <span className="block text-xs font-semibold text-white">
                  Opt in to Kulgo Alternative Supplier Directory
                </span>
                <span className="block text-[11px] text-slate-400">
                  Allow verified buyers searching for resilient alternatives to
                  discover your organization by country, capabilities, and ESG
                  badges.
                </span>
              </div>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-400">
                Public Capabilities (comma-separated)
              </span>
              <input
                type="text"
                value={capabilitiesText}
                onChange={(e) => setCapabilitiesText(e.target.value)}
                placeholder="e.g. Precision CNC, Specialty Alloys, Recycled Aluminum"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </label>

            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>
                Privacy Guarantee: Directory listings never expose your private
                supply links, upstream suppliers, or existing buyers.
              </span>
            </div>
          </section>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300 cursor-pointer"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 px-4 py-2 text-xs font-semibold text-slate-950 cursor-pointer"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Save Org Settings</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
