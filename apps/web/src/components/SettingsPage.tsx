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
  Building2,
  CheckCircle2,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Trash2,
  User as UserIcon,
  UserPlus,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  addOrgMember,
  getAlertPreferences,
  listAuditEvents,
  listOrgMembers,
  removeOrgMember,
  updateAlertPreferences,
  updateOrganizationProfile,
} from "../lib/api.js";
import { ProductCatalogueSection } from "./ProductCatalogueSection.js";

export type SettingsTab = "profile" | "organization" | "team" | "audit";

export interface SettingsPageProps {
  currentUser: User;
  organization: Organization;
  onUpdated: (organization: Organization) => void;
}

const TARGET_MARKET_OPTIONS: ReadonlyArray<{ id: TargetMarket; label: string }> = [
  { id: "EU", label: "EU / EEA (CSRD, VSME, CBAM, EUDR)" },
  { id: "UK", label: "UK (UK SRS, SECR, UK CBAM)" },
  { id: "US", label: "US (CA SB 253, UFLPA)" },
  { id: "APAC", label: "APAC (AU AASB S2, SGX, SSBJ)" },
  { id: "AFRICA", label: "Africa (ISSB, CBAM Export)" },
];

const COMPLIANCE_PACK_OPTIONS: ReadonlyArray<{
  id: CompliancePackId;
  label: string;
}> = [
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
  INTRO_REQUESTED: "bg-amber-500/15 border-amber-500/40 text-amber-300",
};

function formatAuditTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
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

export function SettingsPage({
  currentUser,
  organization,
  onUpdated,
}: SettingsPageProps) {
  const isOwner = currentUser.role === "OWNER";
  const [activeTab, setActiveTab] = useState<SettingsTab>("organization");

  // Organization & Markets state
  const [scope1Text, setScope1Text] = useState("");
  const [scope2Text, setScope2Text] = useState("");
  const [scope2MarketText, setScope2MarketText] = useState("");
  const [annualRevenueText, setAnnualRevenueText] = useState("");
  const [targetMarkets, setTargetMarkets] = useState<TargetMarket[]>([]);
  const [enabledCompliancePacks, setEnabledCompliancePacks] = useState<
    CompliancePackId[]
  >([]);
  const [esgBadges, setEsgBadges] = useState<string[]>([]);
  const [customBadge, setCustomBadge] = useState("");
  const [openToNewBuyers, setOpenToNewBuyers] = useState(false);
  const [capabilitiesText, setCapabilitiesText] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgSaved, setOrgSaved] = useState(false);

  // Alert Preferences state
  const [instantRedEmailEnabled, setInstantRedEmailEnabled] = useState(true);
  const [dailyAmberDigestEnabled, setDailyAmberDigestEnabled] = useState(true);
  const [alertRecipientsText, setAlertRecipientsText] = useState("");
  const [webhookUrlText, setWebhookUrlText] = useState("");
  const [webhookSecretText, setWebhookSecretText] = useState("");
  const [webhookSecretConfigured, setWebhookSecretConfigured] = useState(false);
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [alertsSaved, setAlertsSaved] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);

  // Team Members state
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [memberBanner, setMemberBanner] = useState<string | null>(null);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberPassword, setNewMemberPassword] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<UserRole>("MEMBER");
  const [addingMember, setAddingMember] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  // Audit Log state
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditActionFilter, setAuditActionFilter] = useState<string>("ALL");

  useEffect(() => {
    setScope1Text(
      organization.scope1Tco2e !== null && organization.scope1Tco2e !== undefined
        ? String(organization.scope1Tco2e)
        : "",
    );
    setScope2Text(
      organization.scope2Tco2e !== null && organization.scope2Tco2e !== undefined
        ? String(organization.scope2Tco2e)
        : "",
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
    setTargetMarkets([...(organization.targetMarkets ?? [])]);
    setEnabledCompliancePacks([...(organization.enabledCompliancePacks ?? [])]);
    setEsgBadges([...organization.esgBadges]);
    setOpenToNewBuyers(organization.openToNewBuyers);
    setCapabilitiesText(organization.capabilities.join(", "));
    setOrgError(null);
  }, [organization]);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    setMembersError(null);
    try {
      const list = await listOrgMembers();
      setMembers(list);
    } catch (err) {
      setMembersError(
        err instanceof Error ? err.message : "Failed to load team members.",
      );
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  const loadAuditLog = useCallback(async () => {
    if (!isOwner) return;
    setLoadingAudit(true);
    setAuditError(null);
    try {
      const events = await listAuditEvents(100);
      setAuditEvents(events);
    } catch (err) {
      setAuditError(
        err instanceof Error ? err.message : "Failed to load audit log.",
      );
    } finally {
      setLoadingAudit(false);
    }
  }, [isOwner]);

  const loadAlertPrefs = useCallback(async () => {
    try {
      const prefs = await getAlertPreferences();
      setInstantRedEmailEnabled(prefs.instantRedEmailEnabled);
      setDailyAmberDigestEnabled(prefs.dailyAmberDigestEnabled);
      setAlertRecipientsText((prefs.emailRecipients ?? []).join(", "));
      setWebhookUrlText(prefs.webhookUrl ?? "");
      setWebhookSecretConfigured(Boolean(prefs.webhookSecretConfigured));
      setWebhookSecretText("");
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    void loadMembers();
    void loadAlertPrefs();
    if (isOwner) {
      void loadAuditLog();
    }
  }, [isOwner, loadMembers, loadAlertPrefs, loadAuditLog]);

  const handleSaveOrg = async (e: FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setSavingOrg(true);
    setOrgError(null);
    setOrgSaved(false);
    try {
      const parseNum = (raw: string): number | null => {
        if (!raw.trim()) return null;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error("Numeric values must be non-negative.");
        }
        return n;
      };
      const payload: UpdateOrganizationProfileInput = {
        scope1Tco2e: parseNum(scope1Text),
        scope2Tco2e: parseNum(scope2Text),
        scope2MarketTco2e: parseNum(scope2MarketText),
        annualRevenueEur: parseNum(annualRevenueText),
        targetMarkets,
        enabledCompliancePacks,
        esgBadges,
        openToNewBuyers,
        capabilities: parseCommaList(capabilitiesText),
      };
      const updated = await updateOrganizationProfile(payload);
      onUpdated(updated);
      setOrgSaved(true);
      void loadAuditLog();
    } catch (err) {
      setOrgError(
        err instanceof Error
          ? err.message
          : "Failed to save organization settings.",
      );
    } finally {
      setSavingOrg(false);
    }
  };

  const handleSaveAlerts = async (e: FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setSavingAlerts(true);
    setAlertsError(null);
    setAlertsSaved(false);
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
      setWebhookSecretConfigured(Boolean(updated.webhookSecretConfigured));
      setWebhookSecretText("");
      setAlertsSaved(true);
    } catch (err) {
      setAlertsError(
        err instanceof Error
          ? err.message
          : "Failed to save alert notification preferences.",
      );
    } finally {
      setSavingAlerts(false);
    }
  };

  const handleAddMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setAddingMember(true);
    setMembersError(null);
    setMemberBanner(null);
    try {
      const created = await addOrgMember({
        email: newMemberEmail.trim(),
        password: newMemberPassword,
        role: newMemberRole,
      });
      setMembers((prev) => [...prev, created]);
      setMemberBanner(`Added ${created.email} as ${created.role}.`);
      // Only clear form on confirmed success (#47B)
      setNewMemberEmail("");
      setNewMemberPassword("");
      setNewMemberRole("MEMBER");
      void loadAuditLog();
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
    setRemovingUserId(member.userId);
    setMembersError(null);
    setMemberBanner(null);
    try {
      await removeOrgMember(member.userId);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      setMemberBanner(`Removed ${member.email} from organization.`);
      void loadAuditLog();
    } catch (err) {
      setMembersError(
        err instanceof Error ? err.message : "Failed to remove team member.",
      );
    } finally {
      setRemovingUserId(null);
    }
  };

  const ownerCount = members.filter((m) => m.role === "OWNER").length;
  const filteredAuditEvents = useMemo(() => {
    if (auditActionFilter === "ALL") return auditEvents;
    return auditEvents.filter((ev) => ev.action === auditActionFilter);
  }, [auditEvents, auditActionFilter]);

  const tabs: ReadonlyArray<{
    id: SettingsTab;
    label: string;
    icon: typeof UserIcon;
    ownerOnly?: boolean;
  }> = [
    { id: "profile", label: "My Profile", icon: UserIcon },
    { id: "organization", label: "Organization & Markets", icon: Building2 },
    { id: "team", label: "Team Members & RBAC", icon: Users },
    {
      id: "audit",
      label: "Compliance Audit Log",
      icon: ScrollText,
      ownerOnly: true,
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white">
            Settings &amp; Governance
          </h1>
          <p className="text-xs text-slate-400">
            Manage your profile, organization ESG/compliance markets, team RBAC, and immutable audit log.
          </p>
        </div>

        {/* Settings Tabs */}
        <div
          role="tablist"
          aria-label="Settings sections"
          className="flex flex-wrap gap-1.5 border-b border-slate-800 pb-3"
        >
          {tabs
            .filter((t) => !t.ownerOnly || isOwner)
            .map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`settings-tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition cursor-pointer ${
                    active
                      ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/35"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
        </div>

        {/* TAB 1: My Profile */}
        {activeTab === "profile" && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white">My Profile</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Account Email
                </div>
                <div className="text-sm font-semibold text-white mt-1">
                  {currentUser.email}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Organization Role
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`text-xs font-bold uppercase px-2 py-0.5 rounded border ${
                      isOwner
                        ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/35"
                        : "bg-slate-800 text-slate-300 border-slate-700"
                    }`}
                  >
                    {currentUser.role}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {isOwner
                      ? "Full organization & RBAC administration"
                      : "Read-only org settings; workspace contributor"}
                  </span>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-300 space-y-1">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5 text-emerald-400" />
                Live Alert Notifications
              </div>
              <p className="text-[11px] text-slate-400">
                Instant RED disruption alerts:{" "}
                <strong className="text-slate-200">
                  {instantRedEmailEnabled ? "Enabled" : "Disabled"}
                </strong>{" "}
                · Daily AMBER digest:{" "}
                <strong className="text-slate-200">
                  {dailyAmberDigestEnabled ? "Enabled" : "Disabled"}
                </strong>
                . Organization owners can adjust alert channels under{" "}
                <em>Organization &amp; Markets</em>.
              </p>
            </div>
          </section>
        )}

        {/* TAB 2: Organization & Markets */}
        {activeTab === "organization" && (
          <div className="space-y-5">
            {!isOwner && (
              <div
                data-testid="member-readonly-notice"
                className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5 flex items-center gap-2.5 text-xs text-amber-200"
              >
                <Lock className="h-4 w-4 shrink-0" />
                <span>
                  You are signed in as a <strong>MEMBER</strong>. Organization
                  ESG, Target Markets, and Compliance Pack settings are
                  read-only and can only be edited by an <strong>OWNER</strong>.
                </span>
              </div>
            )}

            <form
              onSubmit={(e) => void handleSaveOrg(e)}
              className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-5"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Organization ESG, Markets &amp; Directory
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    {organization.name} ({organization.countryCode}) ·{" "}
                    {organization.sector}
                  </p>
                </div>
                {orgSaved && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-lg">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Organization ESG &amp; directory settings saved.
                  </span>
                )}
              </div>

              {orgError && (
                <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {orgError}
                </div>
              )}

              {/* Scope 1 / 2 / Revenue */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="text-slate-300 font-medium">
                    Scope 1 Emissions (tCO2e)
                  </span>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    disabled={!isOwner}
                    value={scope1Text}
                    onChange={(e) => setScope1Text(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white disabled:opacity-60"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300 font-medium">
                    Scope 2 Emissions (tCO2e)
                  </span>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    disabled={!isOwner}
                    value={scope2Text}
                    onChange={(e) => setScope2Text(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white disabled:opacity-60"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300 font-medium">
                    Scope 2 Market-Based (tCO2e)
                  </span>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    disabled={!isOwner}
                    value={scope2MarketText}
                    onChange={(e) => setScope2MarketText(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white disabled:opacity-60"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-300 font-medium">
                    Annual Revenue (€ EUR)
                  </span>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    disabled={!isOwner}
                    value={annualRevenueText}
                    onChange={(e) => setAnnualRevenueText(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white disabled:opacity-60"
                  />
                </label>
              </div>

              {/* Target Sales Markets & Regional Compliance Packs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-200">
                    Target Sales / Export Markets
                  </div>
                  <div className="space-y-1.5">
                    {TARGET_MARKET_OPTIONS.map((opt) => {
                      const checked = targetMarkets.includes(opt.id);
                      return (
                        <label
                          key={opt.id}
                          className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            disabled={!isOwner}
                            checked={checked}
                            onChange={() =>
                              setTargetMarkets((prev) =>
                                prev.includes(opt.id)
                                  ? prev.filter((m) => m !== opt.id)
                                  : [...prev, opt.id],
                              )
                            }
                            className="rounded border-slate-700 bg-slate-950 accent-emerald-500"
                          />
                          <span>{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-200">
                    Regional Compliance Packs
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {COMPLIANCE_PACK_OPTIONS.map((pack) => {
                      const active = enabledCompliancePacks.includes(pack.id);
                      return (
                        <button
                          key={pack.id}
                          type="button"
                          disabled={!isOwner}
                          onClick={() =>
                            setEnabledCompliancePacks((prev) =>
                              prev.includes(pack.id)
                                ? prev.filter((p) => p !== pack.id)
                                : [...prev, pack.id],
                            )
                          }
                          className={`rounded-lg border px-2.5 py-1 text-xs transition cursor-pointer disabled:opacity-60 ${
                            active
                              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                              : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"
                          }`}
                        >
                          {pack.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* ESG Badges */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-200">
                  ESG &amp; Sustainability Certifications
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_ESG_BADGES.map((badge) => {
                    const active = esgBadges.includes(badge);
                    return (
                      <button
                        key={badge}
                        type="button"
                        disabled={!isOwner}
                        onClick={() =>
                          setEsgBadges((prev) =>
                            prev.includes(badge)
                              ? prev.filter((b) => b !== badge)
                              : [...prev, badge],
                          )
                        }
                        className={`rounded-full border px-2.5 py-1 text-[11px] transition cursor-pointer disabled:opacity-60 ${
                          active
                            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                            : "border-slate-800 bg-slate-950 text-slate-400"
                        }`}
                      >
                        {badge}
                      </button>
                    );
                  })}
                </div>
                {isOwner && (
                  <div className="flex gap-2 max-w-sm pt-1">
                    <input
                      type="text"
                      value={customBadge}
                      onChange={(e) => setCustomBadge(e.target.value)}
                      placeholder="Add custom certification..."
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const b = customBadge.trim();
                        if (b && !esgBadges.includes(b)) {
                          setEsgBadges((prev) => [...prev, b]);
                        }
                        setCustomBadge("");
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 cursor-pointer"
                    >
                      <Plus className="h-3 w-3" />
                      Add
                    </button>
                  </div>
                )}
              </div>

              {/* Alternative Directory Opt-In */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-2.5">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!isOwner}
                    checked={openToNewBuyers}
                    onChange={(e) => setOpenToNewBuyers(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 accent-emerald-500"
                  />
                  <span className="font-medium">
                    Opt in to Kulgo Alternative Supplier Directory
                  </span>
                </label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={capabilitiesText}
                  onChange={(e) => setCapabilitiesText(e.target.value)}
                  placeholder="Comma-separated capabilities (e.g., CNC Machining, PCB Assembly)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white disabled:opacity-60"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!isOwner || savingOrg}
                  className="rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 px-4 py-2 text-xs font-semibold text-slate-950 cursor-pointer"
                >
                  {savingOrg ? "Saving..." : "Save Org Settings"}
                </button>
              </div>
            </form>

            <ProductCatalogueSection
              organization={organization}
              isOwner={isOwner}
              onEnableDirectoryOptIn={async () => {
                setOpenToNewBuyers(true);
                try {
                  const updated = await updateOrganizationProfile({
                    openToNewBuyers: true,
                    capabilities: parseCommaList(capabilitiesText),
                    targetMarkets,
                    enabledCompliancePacks,
                    esgBadges,
                  });
                  onUpdated(updated);
                  setOrgSaved(true);
                  void loadAuditLog();
                } catch (err) {
                  setOrgError(
                    err instanceof Error
                      ? err.message
                      : "Failed to enable directory opt-in.",
                  );
                }
              }}
            />

            {/* Alert Channels Card */}
            <form
              onSubmit={(e) => void handleSaveAlerts(e)}
              className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-3 text-xs"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Bell className="h-4 w-4 text-amber-400" />
                  Live Disruption Alert Channels
                </h3>
                {alertsSaved && (
                  <span className="text-emerald-300 text-xs">
                    Alert preferences saved.
                  </span>
                )}
              </div>
              {alertsError && (
                <div className="text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {alertsError}
                </div>
              )}
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    disabled={!isOwner}
                    checked={instantRedEmailEnabled}
                    onChange={(e) => setInstantRedEmailEnabled(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  Instant RED Email Alerts
                </label>
                <label className="flex items-center gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    disabled={!isOwner}
                    checked={dailyAmberDigestEnabled}
                    onChange={(e) => setDailyAmberDigestEnabled(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  Daily AMBER Digest
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  disabled={!isOwner}
                  value={alertRecipientsText}
                  onChange={(e) => setAlertRecipientsText(e.target.value)}
                  placeholder="Alert recipient emails (comma-separated)"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white disabled:opacity-60"
                />
                <input
                  type="url"
                  disabled={!isOwner}
                  value={webhookUrlText}
                  onChange={(e) => setWebhookUrlText(e.target.value)}
                  placeholder="Webhook URL (https://...)"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white disabled:opacity-60"
                />
                <input
                  type="password"
                  disabled={!isOwner}
                  value={webhookSecretText}
                  onChange={(e) => setWebhookSecretText(e.target.value)}
                  placeholder={
                    webhookSecretConfigured
                      ? "Webhook secret configured (leave blank to keep)"
                      : "Optional HMAC webhook secret"
                  }
                  className="md:col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-white disabled:opacity-60"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!isOwner || savingAlerts}
                  className="rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-40 px-3.5 py-1.5 text-xs font-semibold text-amber-200 cursor-pointer"
                >
                  {savingAlerts ? "Saving..." : "Save Alert Channels"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 3: Team Members & RBAC */}
        {activeTab === "team" && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Team Members
              </h2>
              <button
                type="button"
                onClick={() => void loadMembers()}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
            </div>

            {memberBanner && (
              <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                {memberBanner}
              </div>
            )}
            {membersError && (
              <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {membersError}
              </div>
            )}

            {loadingMembers ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading team members...
              </div>
            ) : (
              <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/70">
                {members.map((member) => {
                  const isLastOwner = member.role === "OWNER" && ownerCount <= 1;
                  const isSelf = member.userId === currentUser.userId;
                  return (
                    <div
                      key={member.userId}
                      className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">
                          {member.email}
                          {isSelf && (
                            <span className="ml-2 text-[10px] text-slate-400">
                              (you)
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Joined {member.createdAt.slice(0, 10)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                            member.role === "OWNER"
                              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/35"
                              : "bg-slate-800 text-slate-300 border-slate-700"
                          }`}
                        >
                          {member.role}
                        </span>
                        {isOwner && !isSelf && (
                          <button
                            type="button"
                            disabled={isLastOwner || removingUserId === member.userId}
                            title={
                              isLastOwner
                                ? "Cannot remove the last OWNER"
                                : `Remove ${member.email}`
                            }
                            onClick={() => void handleRemoveMember(member)}
                            className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 px-2 py-1 text-[11px] text-red-300 cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3" />
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {isOwner && (
              <form
                onSubmit={(e) => void handleAddMember(e)}
                className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3 text-xs"
              >
                <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <UserPlus className="h-3.5 w-3.5 text-sky-400" />
                  Add Team Member
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="email"
                    required
                    aria-label="New member email"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
                  />
                  <input
                    type="password"
                    required
                    minLength={10}
                    aria-label="New member password"
                    value={newMemberPassword}
                    onChange={(e) => setNewMemberPassword(e.target.value)}
                    placeholder="Temporary password (10+ chars)"
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
                  />
                  <select
                    aria-label="New member role"
                    value={newMemberRole}
                    onChange={(e) => setNewMemberRole(e.target.value as UserRole)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
                  >
                    <option value="MEMBER">MEMBER</option>
                    <option value="OWNER">OWNER</option>
                  </select>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={addingMember}
                    className="rounded-lg bg-sky-500 hover:bg-sky-400 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
                  >
                    {addingMember ? "Adding..." : "Add Member"}
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        {/* TAB 4: Compliance Audit Log (OWNER-only) */}
        {activeTab === "audit" && isOwner && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <ScrollText className="h-4 w-4 text-violet-400" />
                Audit Log
              </h2>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Filter audit actions"
                  value={auditActionFilter}
                  onChange={(e) => setAuditActionFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200"
                >
                  <option value="ALL">All Actions</option>
                  {Object.keys(AUDIT_ACTION_BADGE_STYLES).map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void loadAuditLog()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </button>
              </div>
            </div>

            {auditError && (
              <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {auditError}
              </div>
            )}

            {loadingAudit ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading compliance audit log...
              </div>
            ) : filteredAuditEvents.length === 0 ? (
              <div className="text-xs text-slate-500 py-6 text-center">
                No audit events recorded yet.
              </div>
            ) : (
              <ul
                aria-label="Compliance audit events"
                className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/70"
              >
                {filteredAuditEvents.map((ev) => (
                  <li
                    key={ev.eventId}
                    className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                            AUDIT_ACTION_BADGE_STYLES[ev.action] ??
                            "bg-slate-800 border-slate-700 text-slate-300"
                          }`}
                        >
                          {ev.action}
                        </span>
                        <span className="text-slate-200">{ev.summary}</span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Actor: {ev.actorEmail}
                      </div>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500 shrink-0">
                      {formatAuditTimestamp(ev.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
