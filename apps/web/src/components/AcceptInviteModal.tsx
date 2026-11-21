import type { AcceptInviteResponse, Organization } from "@kulgo/shared";
import {
  CheckCircle2,
  Link2,
  Loader2,
  MapPin,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { acceptInvite } from "../lib/api.js";
import { parseCapabilitiesInput } from "../lib/workspace-utils.js";

export interface AcceptInviteModalProps {
  open: boolean;
  initialToken: string;
  organization: Organization;
  onClose: () => void;
  onAccepted: (result: AcceptInviteResponse) => void;
}

const REFINED_KINDS = ["HQ", "FACTORY", "WAREHOUSE", "PORT", "HUB"] as const;
type RefinedKind = (typeof REFINED_KINDS)[number];

export function AcceptInviteModal({
  open,
  initialToken,
  organization,
  onClose,
  onAccepted,
}: AcceptInviteModalProps) {
  const [token, setToken] = useState(initialToken);
  const [openToNewBuyers, setOpenToNewBuyers] = useState(
    organization.openToNewBuyers ?? false,
  );
  const [capabilitiesRaw, setCapabilitiesRaw] = useState(
    organization.capabilities.length > 0
      ? organization.capabilities.join(", ")
      : organization.sector,
  );
  const [refineSite, setRefineSite] = useState(false);
  const [siteKind, setSiteKind] = useState<RefinedKind>("FACTORY");
  const [siteCountry, setSiteCountry] = useState(organization.countryCode);
  const [siteLat, setSiteLat] = useState("59.4370");
  const [siteLng, setSiteLng] = useState("24.7536");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedResult, setAcceptedResult] =
    useState<AcceptInviteResponse | null>(null);

  useEffect(() => {
    if (open) {
      setToken(initialToken);
      setOpenToNewBuyers(organization.openToNewBuyers ?? false);
      setError(null);
      setAcceptedResult(null);
    }
  }, [open, initialToken, organization.openToNewBuyers]);

  if (!open) {
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setError("Please enter a valid partner invitation token.");
      return;
    }

    let refinedSitePayload:
      | { kind: RefinedKind; lat: number; lng: number; countryCode: string }
      | undefined;

    if (refineSite) {
      const lat = Number(siteLat);
      const lng = Number(siteLng);
      const countryCode = siteCountry.trim().toUpperCase();
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        setError("Latitude must be a valid number between -90 and 90.");
        return;
      }
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        setError("Longitude must be a valid number between -180 and 180.");
        return;
      }
      if (!/^[A-Z]{2}$/.test(countryCode)) {
        setError("Country code must be a 2-letter ISO code (e.g. EE, FI, DE).");
        return;
      }
      refinedSitePayload = {
        kind: siteKind,
        lat,
        lng,
        countryCode,
      };
    }

    setSubmitting(true);
    try {
      const result = await acceptInvite(trimmedToken, {
        openToNewBuyers,
        capabilities: parseCapabilitiesInput(capabilitiesRaw),
        refinedSite: refinedSitePayload,
      });
      setAcceptedResult(result);
      onAccepted(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to accept invitation.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="accept-invite-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-teal-500/15 border border-teal-500/35 flex items-center justify-center text-teal-300">
              <Link2 className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="accept-invite-title"
                className="text-sm font-semibold text-white"
              >
                Accept Partner Verification Invite
              </h2>
              <p className="text-[11px] text-slate-400">
                Joining as <strong className="text-slate-200">{organization.name}</strong> ({organization.countryCode})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close accept invitation modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Privacy guarantee */}
          <div className="rounded-xl border border-teal-500/30 bg-teal-500/10 p-3 text-xs text-teal-100 flex items-start gap-2.5">
            <ShieldCheck className="h-4 w-4 text-teal-300 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>Strict Privacy Guarantee:</strong> Your upstream suppliers,
              names, emails, and exact coordinates are <strong>never</strong>{" "}
              shared with your buyer. Only anonymized Scope 3 totals and
              region-level risk alerts are computed server-side.
            </p>
          </div>

          {acceptedResult ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-xs text-emerald-100 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Partner Link Verified!</span>
                </div>
                <p className="text-emerald-100/90">
                  Your organization is now linked as a{" "}
                  <strong>Network-Verified</strong> partner. Directory listing:{" "}
                  <strong>
                    {acceptedResult.organization.openToNewBuyers
                      ? "Opted In"
                      : "Private"}
                  </strong>
                  .
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs px-4 py-2 transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  One-Time Invitation Token
                </label>
                <input
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste invite token from your buyer..."
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-slate-100 focus:border-teal-500 focus:outline-none"
                />
              </div>

              {/* Opt-in Alternative Directory */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 space-y-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={openToNewBuyers}
                    onChange={(e) => setOpenToNewBuyers(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-slate-900 text-teal-500"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-white">
                      Opt into Alternative Suppliers Directory
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Appear as a verified EU/Nordic candidate to new buyers
                      (exposes only public capabilities &amp; ESG badges — never
                      existing buyers).
                    </p>
                  </div>
                </label>

                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Declared Capabilities (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={capabilitiesRaw}
                    onChange={(e) => setCapabilitiesRaw(e.target.value)}
                    placeholder="Aluminum Alloys, Precision CNC, EU Cold-Rolled Steel"
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-teal-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Optional Site Precision Refinement */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 space-y-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={refineSite}
                    onChange={(e) => setRefineSite(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 bg-slate-900 text-teal-500"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-white inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-cyan-400" />
                      Refine Site Coordinates (SITE_VERIFIED)
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Upgrade your buyer&apos;s estimated HQ pin to your exact
                      manufacturing, warehouse, or port coordinates.
                    </p>
                  </div>
                </label>

                {refineSite && (
                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <div>
                      <label className="block text-[10px] uppercase text-slate-500 mb-1">
                        Facility Kind
                      </label>
                      <select
                        value={siteKind}
                        onChange={(e) =>
                          setSiteKind(e.target.value as RefinedKind)
                        }
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
                      >
                        {REFINED_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase text-slate-500 mb-1">
                        Country (ISO-2)
                      </label>
                      <input
                        type="text"
                        maxLength={2}
                        value={siteCountry}
                        onChange={(e) =>
                          setSiteCountry(e.target.value.toUpperCase())
                        }
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-mono text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase text-slate-500 mb-1">
                        Latitude
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={siteLat}
                        onChange={(e) => setSiteLat(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-mono text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase text-slate-500 mb-1">
                        Longitude
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={siteLng}
                        onChange={(e) => setSiteLng(e.target.value)}
                        className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-mono text-slate-100"
                      />
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium px-3.5 py-2 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 font-semibold text-xs px-4 py-2 transition-colors cursor-pointer"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Accept &amp; Verify Link</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
