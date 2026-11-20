import {
  LoginInputSchema,
  RegisterInputSchema,
  type AuthMeResponse,
} from "@kulgo/shared";
import {
  AlertCircle,
  ArrowRight,
  Globe2,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, login, register } from "../lib/api.js";

export interface AuthViewProps {
  onAuthenticated: (session: AuthMeResponse) => void;
}

type AuthTab = "login" | "register";

export function AuthView({ onAuthenticated }: AuthViewProps) {
  const [tab, setTab] = useState<AuthTab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [countryCode, setCountryCode] = useState("EE");
  const [sector, setSector] = useState("Manufacturing");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const switchTab = (nextTab: AuthTab) => {
    setTab(nextTab);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (tab === "login") {
      const parsed = LoginInputSchema.safeParse({
        email: email.trim(),
        password,
      });
      if (!parsed.success) {
        const firstIssue = parsed.error.issues[0];
        setError(firstIssue?.message ?? "Please enter a valid email and password.");
        return;
      }

      setSubmitting(true);
      try {
        const session = await login(parsed.data);
        onAuthenticated(session);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Unable to sign in. Check that the Kulgo API is running.");
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const parsed = RegisterInputSchema.safeParse({
      email: email.trim(),
      password,
      organizationName: organizationName.trim(),
      countryCode: countryCode.trim().toUpperCase(),
      sector: sector.trim() || "Manufacturing",
    });

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setError(
        firstIssue?.message ?? "Please complete all required organization fields.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const session = await register(parsed.data);
      onAuthenticated(session);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to create account. Check that the Kulgo API is running.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center px-4 py-10 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_45%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.08),transparent_45%)]"
      />

      <div className="relative w-full max-w-md mx-auto space-y-6">
        <div className="flex flex-col items-center text-center space-y-2.5">
          <div className="h-11 w-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-950/50">
            <Globe2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Kulgo
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Privacy-first supply chain mapping &amp; resilience
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/90 backdrop-blur-sm shadow-2xl shadow-black/50 p-6 space-y-5">
          <div
            role="tablist"
            aria-label="Authentication mode"
            className="grid grid-cols-2 rounded-xl bg-slate-950/80 p-1 border border-slate-800/80"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "login"}
              onClick={() => switchTab("login")}
              className={`py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                tab === "login"
                  ? "bg-slate-800 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "register"}
              onClick={() => switchTab("register")}
              className={`py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                tab === "register"
                  ? "bg-slate-800 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Create Workspace
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200"
            >
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                Work Email
              </label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ops@nordic-mfg.ee"
                className="w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-medium uppercase tracking-wider text-slate-400"
                >
                  Password
                </label>
                {tab === "register" && (
                  <span className="text-[11px] text-slate-500">
                    Min 10 characters
                  </span>
                )}
              </div>
              <input
                id="auth-password"
                type="password"
                autoComplete={
                  tab === "login" ? "current-password" : "new-password"
                }
                required
                minLength={tab === "register" ? 10 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            {tab === "register" && (
              <>
                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-org-name"
                    className="block text-xs font-medium uppercase tracking-wider text-slate-400"
                  >
                    Organization Name
                  </label>
                  <input
                    id="auth-org-name"
                    type="text"
                    required
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    placeholder="Baltic Precision OÜ"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="auth-country"
                      className="block text-xs font-medium uppercase tracking-wider text-slate-400"
                    >
                      Country
                    </label>
                    <input
                      id="auth-country"
                      type="text"
                      maxLength={2}
                      required
                      value={countryCode}
                      onChange={(e) =>
                        setCountryCode(e.target.value.toUpperCase())
                      }
                      placeholder="EE"
                      className="w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm font-mono uppercase text-slate-100 placeholder-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>

                  <div className="col-span-2 space-y-1.5">
                    <label
                      htmlFor="auth-sector"
                      className="block text-xs font-medium uppercase tracking-wider text-slate-400"
                    >
                      Sector
                    </label>
                    <input
                      id="auth-sector"
                      type="text"
                      required
                      value={sector}
                      onChange={(e) => setSector(e.target.value)}
                      placeholder="Manufacturing"
                      className="w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed text-slate-950 font-semibold text-sm py-2.5 px-4 transition-colors cursor-pointer shadow-lg shadow-emerald-500/15"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>
                    {tab === "login"
                      ? "Signing in..."
                      : "Creating workspace..."}
                  </span>
                </>
              ) : (
                <>
                  <span>
                    {tab === "login"
                      ? "Sign In to Workspace"
                      : "Create Private Workspace"}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Org-isolated private graph
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-slate-500" />
              Argon2id + HttpOnly
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
