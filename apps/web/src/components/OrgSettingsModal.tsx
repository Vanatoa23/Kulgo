import type {
  AuditAction,
  AuditEvent,
  CompliancePackId,
  Organization,
  OrgMember,
  TargetMarket,
  UpdateOrganizationProfileInput,
  User,
  UserRole,
} from "@kulgo/shared";
import {
  Bell,
  CheckCircle2,
  Globe2,
  Leaf,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  ScrollText,
  Settings2,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  addOrgMember,
  getAlertPreferences,
  listAuditEvents,
  listOrgMembers,
  removeOrgMember,
  updateAlertPreferences,
  updateOrganizationProfile,
} from "../lib/api.js";

export interface OrgSettingsModalProps {
  open: boolean;
  currentUser: User;
  organization: Organization;
  onClose: () => void;
  onUpdated: (organization: Organization) => void;
}

const TARGET_MARKET_OPTIONS: ReadonlyArray<{ id: TargetMarket; label: string }> = [
  { id: "EU", label: "EU / EEA (CSRD, VSME, CBAM, EUDR)" },
  { id: "UK", label: "UK (UK SRS, SECR, UK CBAM)" },
  { id: "US", label: "US (CA SB 253, UFLPA)" },
  { id: "APAC", label: "APAC (AU AASB S2, SGX, SSBJ)" },
  { id: "AFRICA", label: "Africa (ISSB, CBAM Export)" },
];

const COMPLIANCE_PACK_OPTIONS: ReadonlyArray<{ id: CompliancePackId; label: string }> = [
  { id: "GLOBAL_GHG_ISSB", label: "Global GHG + ISSB" },
  { id: "EU", label: "EU Pack" },
  { id: "UK", label: "UK Pack" },
  { id: "US", label: "US Pack" },
  { id: "APAC", label: "APAC Pack" },
  { id: "AFRICA", label: "Africa Pack" },
];

const PRESET_ESG_BADGES = [
  "ISO 14001",
  "EcoVadis Gold",
  "SBTi Committed",
  "RE100",
  "CSRD Ready",
  "ISO 50001",
];

const AUDIT_ACTION_BADGE_STYLES: Record<AuditAction, string> = {
  ORG_PROFILE_UPDATED:
    "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  MEMBER_ADDED: "bg-sky-500/15 border-sky-500/40 text-sky-300",
  MEMBER_REMOVED: "bg-red-500/15 border-red-500/40 text-red-300",
  BULK_IMPORT_EXECUTED:
    "bg-indigo-500/15 border-indigo-500/40 text-indigo-300",
  INVITE_CREATED: "bg-teal-500/15 border-teal-500/40 text-teal-300",
  INVITE_ACCEPTED: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  INVITE_REVOKED: "bg-amber-500/15 border-amber-500/40 text-amber-300",
  CSRD_REPORT_EXPORTED:
    "bg-violet-500/15 border-violet-500/40 text-violet-300",
  ESG_LEDGER_EXPORTED:
    "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  CATALOGUE_UPDATED: "bg-cyan-500/15 border-cyan-500/40 text-cyan-300",
  INTRO_REQUESTED: "bg-sky-500/15 border-sky-500/40 text-sky-300",
};

function formatAuditTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

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
  currentUser,
  organization,
  onClose,
  onUpdated,
}: OrgSettingsModalProps) {
  const isOwner = currentUser.role === "OWNER";

  const [scope1Text, setScope1Text] = useState("");
  const [scope2Text, setScope2Text] = useState("");
  const [scope2MarketText, setScope2MarketText] = useState("");
  const [annualRevenueText, setAnnualRevenueText] = useState("");
  const [targetMarkets, setTargetMarkets] = useState<TargetMarket[]>([]);
  const [enabledCompliancePacks, setEnabledCompliancePacks] = useState<CompliancePackId[]>([]);
  const [esgBadges, setEsgBadges] = useState<string[]>([]);
  const [customBadge, setCustomBadge] = useState("");
  const [openToNewBuyers, setOpenToNewBuyers] = useState(false);
  const [capabilitiesText, setCapabilitiesText] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);

  // Team Members (M5 RBAC)
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [memberBanner, setMemberBanner] = useState<string | null>(null);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberPassword, setNewMemberPassword] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<UserRole>("MEMBER");
  const [addingMember, setAddingMember] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  // Compliance Audit Log (M6 OWNER-only)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loadingAuditLog, setLoadingAuditLog] = useState(false);
  const [auditLogError, setAuditLogError] = useState<string | null>(null);

  // Alert Notification Channels (Sub-Project 1)
  const [instantRedEmailEnabled, setInstantRedEmailEnabled] = useState(true);
  const [dailyAmberDigestEnabled, setDailyAmberDigestEnabled] = useState(true);
  const [alertRecipientsText, setAlertRecipientsText] = useState("");
  const [webhookUrlText, setWebhookUrlText] = useState("");
  const [webhookSecretText, setWebhookSecretText] = useState("");
  const [webhookSecretConfigured, setWebhookSecretConfigured] = useState(false);
  const [savingAlertPrefs, setSavingAlertPrefs] = useState(false);
  const [alertPrefsSaved, setAlertPrefsSaved] = useState(false);
  const [alertPrefsError, setAlertPrefsError] = useState<string | null>(null);

  const handleSaveAlertPrefs = async (e: FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setSavingAlertPrefs(true);
    setAlertPrefsError(null);
    setAlertPrefsSaved(false);
    try {
      const updated = await updateAlertPreferences({
        instantRedEmailEnabled,
        dailyAmberDigestEnabled,
        emailRecipients: parseCommaList(alertRecipientsText),
        webhookUrl: webhookUrlText.trim() || null,
        ...(webhookSecretText.trim()
          ? { webhookSecret: webhookSecretText.trim() }
          : {}),
      });
      setWebhookSecretConfigured(updated.webhookSecretConfigured);
      setWebhookSecretText("");
      setAlertPrefsSaved(true);
    } catch (err) {
      setAlertPrefsError(
        err instanceof Error
          ? err.message
          : "Failed to save alert notification preferences.",
      );
    } finally {
      setSavingAlertPrefs(false);
    }
  };

  const refreshAuditLog = useCallback(async () => {
    if (!isOwner) return;
    setLoadingAuditLog(true);
    setAuditLogError(null);
    try {
      const events = await listAuditEvents(50);
      setAuditEvents(events);
    } catch (err) {
      setAuditLogError(
        err instanceof Error
          ? err.message
          : "Failed to load compliance audit log.",
      );
    } finally {
      setLoadingAuditLog(false);
    }
  }, [isOwner]);

  useEffect(() => {
    if (!open) return;
    setScope1Text(
      organization.scope1Tco2e !== null ? String(organization.scope1Tco2e) : "",
    );
    setScope2Text(
      organization.scope2Tco2e !== null ? String(organization.scope2Tco2e) : "",
    );
    setScope2MarketText(
      organization.scope2MarketTco2e !== null &&
        organization.scope2MarketTco2e !== undefined
        ? String(organization.scope2MarketTco2e)
        : "",
    );
    setAnnualRevenueText(
      organization.annualRevenueEur !== null &&
        organization.annualRevenueEur !== undefined
        ? String(organization.annualRevenueEur)
        : "",
    );
    setTargetMarkets(organization.targetMarkets ?? []);
    setEnabledCompliancePacks(organization.enabledCompliancePacks ?? []);
    setEsgBadges(organization.esgBadges);
    setCustomBadge("");
    setOpenToNewBuyers(organization.openToNewBuyers);
    setCapabilitiesText(organization.capabilities.join(", "));
    setError(null);
    setSavedBanner(false);
    setMembersError(null);
    setMemberBanner(null);
    setNewMemberEmail("");
    setNewMemberPassword("");
    setNewMemberRole("MEMBER");
    setAuditLogError(null);
    setAlertPrefsError(null);
    setAlertPrefsSaved(false);
    setWebhookSecretText("");

    let cancelled = false;
    getAlertPreferences()
      .then((pref) => {
        if (!cancelled) {
          setInstantRedEmailEnabled(pref.instantRedEmailEnabled);
          setDailyAmberDigestEnabled(pref.dailyAmberDigestEnabled);
          setAlertRecipientsText(pref.emailRecipients.join(", "));
          setWebhookUrlText(pref.webhookUrl ?? "");
          setWebhookSecretConfigured(pref.webhookSecretConfigured);
        }
      })
      .catch(() => {
        // Ignore non-fatal error when alert prefs are unavailable
      });

    setLoadingMembers(true);
    listOrgMembers()
      .then((list) => {
        if (!cancelled) {
          setMembers(list);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setMembersError(
            err instanceof Error
              ? err.message
              : "Failed to load organization team members.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingMembers(false);
        }
      });

    if (isOwner) {
      setLoadingAuditLog(true);
      listAuditEvents(50)
        .then((events) => {
          if (!cancelled) {
            setAuditEvents(events);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setAuditLogError(
              err instanceof Error
                ? err.message
                : "Failed to load compliance audit log.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoadingAuditLog(false);
          }
        });
    } else {
      setAuditEvents([]);
    }

    return () => {
      cancelled = true;
    };
    // Intentionally only re-initialize when the modal opens or orgId/role changes,
    // so saving settings (which updates `organization`) preserves `savedBanner`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, organization.orgId, isOwner]);

  if (!open) {
    return null;
  }

  const ownerCount = members.filter((m) => m.role === "OWNER").length;

  const toggleBadge = (badge: string) => {
    if (!isOwner) return;
    setEsgBadges((prev) =>
      prev.includes(badge) ? prev.filter((b) => b !== badge) : [...prev, badge],
    );
  };

  const handleAddCustomBadge = () => {
    if (!isOwner) return;
    const trimmed = customBadge.trim();
    if (!trimmed) return;
    if (!esgBadges.includes(trimmed)) {
      setEsgBadges((prev) => [...prev, trimmed]);
    }
    setCustomBadge("");
  };

  const toggleTargetMarket = (market: TargetMarket) => {
    setTargetMarkets((prev) =>
      prev.includes(market) ? prev.filter((m) => m !== market) : [...prev, market],
    );
  };

  const toggleCompliancePack = (pack: CompliancePackId) => {
    setEnabledCompliancePacks((prev) =>
      prev.includes(pack) ? prev.filter((p) => p !== pack) : [...prev, pack],
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setError(null);
    setSavedBanner(false);

    const parsedScope1 =
      scope1Text.trim() === "" ? null : Number(scope1Text.trim());
    const parsedScope2 =
      scope2Text.trim() === "" ? null : Number(scope2Text.trim());
    const parsedScope2Market =
      scope2MarketText.trim() === "" ? null : Number(scope2MarketText.trim());
    const parsedAnnualRevenue =
      annualRevenueText.trim() === "" ? null : Number(annualRevenueText.trim());

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
    if (
      parsedScope2Market !== null &&
      (!Number.isFinite(parsedScope2Market) || parsedScope2Market < 0)
    ) {
      setError("Scope 2 market-based emissions must be a non-negative number.");
      return;
    }
    if (
      parsedAnnualRevenue !== null &&
      (!Number.isFinite(parsedAnnualRevenue) || parsedAnnualRevenue < 0)
    ) {
      setError("Annual revenue (EUR) must be a non-negative number.");
      return;
    }

    const payload: UpdateOrganizationProfileInput = {
      scope1Tco2e: parsedScope1,
      scope2Tco2e: parsedScope2,
      scope2MarketTco2e: parsedScope2Market,
      annualRevenueEur: parsedAnnualRevenue,
      targetMarkets,
      enabledCompliancePacks,
      esgBadges,
      openToNewBuyers,
      capabilities: parseCommaList(capabilitiesText),
    };

    setSaving(true);
    try {
      const updated = await updateOrganizationProfile(payload);
      onUpdated(updated);
      setSavedBanner(true);
      void refreshAuditLog();
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

  const handleAddMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setMembersError(null);
    setMemberBanner(null);

    const trimmedEmail = newMemberEmail.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setMembersError("Please enter a valid work email address.");
      return;
    }
    if (newMemberPassword.length < 10) {
      setMembersError("Initial password must be at least 10 characters.");
      return;
    }

    setAddingMember(true);
    try {
      const created = await addOrgMember({
        email: trimmedEmail,
        password: newMemberPassword,
        role: newMemberRole,
      });
      setMembers((prev) => [...prev, created]);
      setNewMemberEmail("");
      setNewMemberPassword("");
      setNewMemberRole("MEMBER");
      setMemberBanner(`Added ${created.email} as ${created.role}.`);
      void refreshAuditLog();
    } catch (err) {
      setMembersError(
        err instanceof Error ? err.message : "Failed to add team member.",
      );
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (member: OrgMember) => {
    if (!isOwner) return;
    setMembersError(null);
    setMemberBanner(null);
    setRemovingUserId(member.userId);
    try {
      await removeOrgMember(member.userId);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      setMemberBanner(`Removed ${member.email} from ${organization.name}.`);
      void refreshAuditLog();
    } catch (err) {
      setMembersError(
        err instanceof Error ? err.message : "Failed to remove team member.",
      );
    } finally {
      setRemovingUserId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="org-settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-400">
              <Settings2 className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="org-settings-modal-title"
                  className="text-sm font-semibold text-white"
                >
                  Org ESG, Directory &amp; Team Settings
                </h2>
                <span
                  className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${
                    isOwner
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "bg-sky-500/15 border-sky-500/40 text-sky-300"
                  }`}
                >
                  {currentUser.role}
                </span>
              </div>
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

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {!isOwner && (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-center gap-2">
              <Lock className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                You are signed in as a <strong>MEMBER</strong>. Only
                organization <strong>OWNER</strong> users can update Org ESG
                settings or manage team members.
              </span>
            </div>
          )}

          {/* Org ESG & Directory Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
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
                <span>
                  Annual Direct &amp; Energy Emissions (CSRD Scope 1 &amp; 2)
                </span>
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
                    disabled={!isOwner}
                    value={scope1Text}
                    onChange={(e) => setScope1Text(e.target.value)}
                    placeholder="e.g. 420"
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-400">
                    Scope 2 Emissions (Location-Based, tCO2e / yr)
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    disabled={!isOwner}
                    value={scope2Text}
                    onChange={(e) => setScope2Text(e.target.value)}
                    placeholder="e.g. 185"
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-400">
                    Scope 2 Market-Based (tCO2e / yr, optional)
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    disabled={!isOwner}
                    value={scope2MarketText}
                    onChange={(e) => setScope2MarketText(e.target.value)}
                    placeholder="e.g. 140 (with GOs/RECs)"
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-400">
                    Annual Revenue (EUR — Private, Never Shared)
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    disabled={!isOwner}
                    value={annualRevenueText}
                    onChange={(e) => setAnnualRevenueText(e.target.value)}
                    placeholder="e.g. 8000000 (for tCO2e/€M & partner intensity)"
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                  />
                </label>
              </div>
            </section>

            {/* Target Sales / Export Markets & Multi-Region Compliance Packs */}
            <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Globe2 className="h-3.5 w-3.5 text-sky-400" />
                <span>Target Sales / Export Markets &amp; Compliance Packs</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Active compliance packs auto-detect from your HQ country (
                <span className="font-mono text-slate-200">{organization.countryCode}</span>
                ) and selected export markets. Global GHG Protocol + ISSB (IFRS S1/S2) is always active.
              </p>

              <div className="space-y-1.5">
                <span className="block text-[11px] font-medium text-slate-400">
                  Target Sales / Export Markets
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {TARGET_MARKET_OPTIONS.map((market) => {
                    const active = targetMarkets.includes(market.id);
                    return (
                      <button
                        key={market.id}
                        type="button"
                        disabled={!isOwner}
                        onClick={() => toggleTargetMarket(market.id)}
                        data-testid={`target-market-${market.id}`}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                          active
                            ? "bg-sky-500/20 border-sky-500/50 text-sky-200"
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {active ? "✓ " : "+ "}
                        {market.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <span className="block text-[11px] font-medium text-slate-400">
                  Manual Compliance Pack Overrides (leave empty for auto-detect)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {COMPLIANCE_PACK_OPTIONS.map((pack) => {
                    const active = enabledCompliancePacks.includes(pack.id);
                    return (
                      <button
                        key={pack.id}
                        type="button"
                        disabled={!isOwner}
                        onClick={() => toggleCompliancePack(pack.id)}
                        data-testid={`compliance-pack-${pack.id}`}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                          active
                            ? "bg-violet-500/20 border-violet-500/50 text-violet-200"
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {active ? "✓ " : "+ "}
                        {pack.label}
                      </button>
                    );
                  })}
                </div>
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
                      disabled={!isOwner}
                      onClick={() => toggleBadge(badge)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
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
                      disabled={!isOwner}
                      onClick={() => toggleBadge(badge)}
                      className="px-2.5 py-1 rounded-full text-[11px] font-medium border bg-emerald-500/20 border-emerald-500/50 text-emerald-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      ✓ {badge} ×
                    </button>
                  ))}
              </div>
              {isOwner && (
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
              )}
            </section>

            {/* Alternative Supplier Directory Opt-In */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={!isOwner}
                  checked={openToNewBuyers}
                  onChange={(e) => setOpenToNewBuyers(e.target.checked)}
                  className="mt-0.5 rounded border-slate-700 bg-slate-950 text-emerald-500 disabled:opacity-60"
                />
                <div className="space-y-0.5">
                  <span className="block text-xs font-semibold text-white">
                    Opt in to Kulgo Alternative Supplier Directory
                  </span>
                  <span className="block text-[11px] text-slate-400">
                    Allow verified buyers searching for resilient alternatives
                    to discover your organization by country, capabilities, and
                    ESG badges.
                  </span>
                </div>
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-400">
                  Public Capabilities (comma-separated)
                </span>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={capabilitiesText}
                  onChange={(e) => setCapabilitiesText(e.target.value)}
                  placeholder="e.g. Precision CNC, Specialty Alloys, Recycled Aluminum"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
                />
              </label>

              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span>
                  Privacy Guarantee: Directory listings never expose your
                  private supply links, upstream suppliers, or existing buyers.
                </span>
              </div>
            </section>

            {/* Save Org Settings Action */}
            <div className="flex items-center justify-end gap-2">
              <button
                type="submit"
                disabled={saving || !isOwner}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-xs font-semibold text-slate-950 cursor-pointer"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Save Org Settings</span>
              </button>
            </div>
          </form>

          {/* Team Members (RBAC) */}
          <section
            aria-labelledby="org-team-members-heading"
            className="pt-5 border-t border-slate-800 space-y-3.5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Users className="h-3.5 w-3.5 text-sky-400" />
                <h3 id="org-team-members-heading">Team Members</h3>
              </div>
              <span className="text-[11px] text-slate-500 font-mono">
                {members.length} member{members.length === 1 ? "" : "s"}
              </span>
            </div>

            {membersError && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                {membersError}
              </div>
            )}

            {memberBanner && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>{memberBanner}</span>
              </div>
            )}

            {loadingMembers ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
                <span>Loading team members...</span>
              </div>
            ) : (
              <ul className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
                {members.map((member) => {
                  const isSelf = member.userId === currentUser.userId;
                  const isLastOwner =
                    member.role === "OWNER" && ownerCount <= 1;
                  const canRemove = isOwner && !isLastOwner;
                  return (
                    <li
                      key={member.userId}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="truncate font-medium text-slate-100">
                          {member.email}
                        </span>
                        {isSelf && (
                          <span className="text-[10px] text-slate-400">
                            (You)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`font-mono text-[10px] px-2 py-0.5 rounded border ${
                            member.role === "OWNER"
                              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                              : "bg-sky-500/15 border-sky-500/40 text-sky-300"
                          }`}
                        >
                          {member.role}
                        </span>
                        {isOwner && (
                          <button
                            type="button"
                            disabled={!canRemove || removingUserId !== null}
                            onClick={() => handleRemoveMember(member)}
                            title={
                              isLastOwner
                                ? "Cannot remove the last organization owner"
                                : `Remove ${member.email}`
                            }
                            aria-label={`Remove ${member.email}`}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950 hover:border-red-500/40 hover:bg-red-950/40 hover:text-red-200 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 text-[11px] text-slate-400 transition-colors cursor-pointer"
                          >
                            {removingUserId === member.userId ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                            <span>Remove</span>
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {isOwner && (
              <form
                onSubmit={handleAddMember}
                className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 space-y-3"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <UserPlus className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Add Team Member</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="email"
                    required
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="colleague@company.ee"
                    aria-label="New member email"
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
                  />
                  <input
                    type="password"
                    required
                    minLength={10}
                    value={newMemberPassword}
                    onChange={(e) => setNewMemberPassword(e.target.value)}
                    placeholder="Initial password (min 10 chars)"
                    aria-label="New member password"
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
                  />
                  <select
                    value={newMemberRole}
                    onChange={(e) =>
                      setNewMemberRole(e.target.value as UserRole)
                    }
                    aria-label="New member role"
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="MEMBER">MEMBER (Workspace &amp; Analytics)</option>
                    <option value="OWNER">OWNER (Full Admin &amp; Settings)</option>
                  </select>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={addingMember}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 hover:bg-sky-500/25 disabled:opacity-50 px-3.5 py-1.5 text-xs font-semibold text-sky-200 cursor-pointer"
                  >
                    {addingMember ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="h-3.5 w-3.5" />
                    )}
                    <span>Add Member</span>
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* Compliance Audit Log (OWNER-only) */}
          {isOwner && (
            <section
              aria-labelledby="org-audit-log-heading"
              className="pt-5 border-t border-slate-800 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <ScrollText className="h-3.5 w-3.5 text-violet-400" />
                  <h3 id="org-audit-log-heading">Audit Log</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 font-mono">
                    {auditEvents.length} event
                    {auditEvents.length === 1 ? "" : "s"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshAuditLog()}
                    disabled={loadingAuditLog}
                    aria-label="Refresh audit log"
                    className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 px-2 py-1 text-[11px] text-slate-300 cursor-pointer"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${loadingAuditLog ? "animate-spin" : ""}`}
                    />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {auditLogError && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                  {auditLogError}
                </div>
              )}

              {loadingAuditLog && auditEvents.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                  <span>Loading compliance audit log...</span>
                </div>
              ) : auditEvents.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3.5 text-xs text-slate-400">
                  No security or CSRD compliance events recorded yet.
                </div>
              ) : (
                <ul
                  aria-label="Compliance audit events"
                  className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-900/40 max-h-64 overflow-y-auto"
                >
                  {auditEvents.map((ev) => (
                    <li
                      key={ev.eventId}
                      className="px-3.5 py-2.5 text-xs space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`font-mono text-[10px] px-2 py-0.5 rounded border shrink-0 ${
                              AUDIT_ACTION_BADGE_STYLES[ev.action]
                            }`}
                          >
                            {ev.action}
                          </span>
                          <span className="truncate font-medium text-slate-200">
                            {ev.actorEmail}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-slate-500 shrink-0">
                          {formatAuditTimestamp(ev.createdAt)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {ev.summary}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Alert Notification Channels (Sub-Project 1) */}
          <section className="space-y-3 pt-4 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-white">
                  Live Disruption Alert Channels
                </h3>
              </div>
              {webhookSecretConfigured && (
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/35 px-2 py-0.5 text-[10px] text-emerald-300">
                  HMAC Secret Configured
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Anti-fatigue delivery: instant emails &amp; signed webhooks fire
              only for new confirmed/corroborated RED disruptions.
            </p>

            <form onSubmit={(e) => void handleSaveAlertPrefs(e)} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!isOwner}
                    checked={instantRedEmailEnabled}
                    onChange={(e) => setInstantRedEmailEnabled(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-emerald-500"
                  />
                  Instant RED Email Alerts
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!isOwner}
                    checked={dailyAmberDigestEnabled}
                    onChange={(e) =>
                      setDailyAmberDigestEnabled(e.target.checked)
                    }
                    className="rounded border-slate-700 bg-slate-950 text-emerald-500"
                  />
                  Daily AMBER Morning Digest
                </label>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Alert Email Recipients (comma-separated)
                </label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={alertRecipientsText}
                  onChange={(e) => setAlertRecipientsText(e.target.value)}
                  placeholder="ops@company.eu, risk@company.eu"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Webhook URL (optional)
                  </label>
                  <input
                    type="url"
                    disabled={!isOwner}
                    value={webhookUrlText}
                    onChange={(e) => setWebhookUrlText(e.target.value)}
                    placeholder="https://hooks.company.eu/kulgo"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    HMAC Signing Secret (min 16 chars)
                  </label>
                  <input
                    type="password"
                    disabled={!isOwner}
                    value={webhookSecretText}
                    onChange={(e) => setWebhookSecretText(e.target.value)}
                    placeholder={
                      webhookSecretConfigured
                        ? "•••••••• (leave blank to keep)"
                        : "Enter signing secret"
                    }
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
                  />
                </div>
              </div>

              {alertPrefsError && (
                <p className="text-xs text-red-400">{alertPrefsError}</p>
              )}
              {alertPrefsSaved && (
                <p className="text-xs text-emerald-400">
                  Alert notification channels saved.
                </p>
              )}

              {isOwner && (
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingAlertPrefs}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white cursor-pointer"
                  >
                    {savingAlertPrefs && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Save Alert Channels
                  </button>
                </div>
              )}
            </form>
          </section>

          {/* Footer Close */}
          <div className="flex items-center justify-end pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
