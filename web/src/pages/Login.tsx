import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { BrandMark } from "../components/layout/BrandMark";
import { ApiError } from "../lib/api";
import { useLogin } from "../lib/queries";

/** Keep authentication failures deliberately non-specific: the backend does
 * not reveal which credential was wrong, and neither should its interface. */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "invalid_credentials") return "Those details are incorrect.";
    if (error.code === "too_many_attempts")
      return "Too many attempts. Wait a few minutes and try again.";
  }
  return "Something went wrong. Try again.";
}

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const login = useLogin();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate({ username, password }, { onSuccess: () => navigate("/") });
  }

  return (
    <main className="relative grid min-h-full place-items-center overflow-hidden px-5 py-10 sm:px-8">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,color-mix(in_srgb,var(--color-accent)_18%,transparent),transparent_28rem),radial-gradient(circle_at_86%_80%,color-mix(in_srgb,var(--color-series-1)_12%,transparent),transparent_34rem)]"
      />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-rule bg-surface-raised shadow-2xl lg:grid-cols-[1.08fr_0.92fr]">
        <section className="flex min-h-76 flex-col justify-between bg-rail p-7 text-rail-ink sm:p-10 lg:min-h-150">
          <BrandMark />
          <div className="max-w-md py-12">
            <p className="page-eyebrow text-rail-muted">Private by construction</p>
            <p className="font-display text-4xl leading-[0.98] font-semibold tracking-[-0.045em] sm:text-5xl">
              Privacy-first link intelligence.
            </p>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-rail-muted">
              Short links, useful answers, and no IP address stored along the way.
            </p>
          </div>
          <p className="text-xs text-rail-muted">Your deployment. Your data. No third parties.</p>
        </section>

        <section className="flex items-center p-7 sm:p-10 lg:p-14" aria-labelledby="login-title">
          <div className="w-full">
            <p className="page-eyebrow">Operator access</p>
            <h1
              id="login-title"
              className="font-display text-4xl font-semibold tracking-tight text-ink"
            >
              Sign in
            </h1>
            <p className="mt-2 text-sm text-ink-muted">Continue to your MargioLink workspace.</p>
            <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit}>
              <fieldset className="flex flex-col gap-5" disabled={login.isPending}>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="username" className="text-xs font-semibold text-ink-muted">
                    Username
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="min-h-12 rounded-xl border border-rule bg-surface px-3.5 py-2 text-ink shadow-inner transition-colors hover:border-rule-strong"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="password" className="text-xs font-semibold text-ink-muted">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="min-h-12 rounded-xl border border-rule bg-surface px-3.5 py-2 text-ink shadow-inner transition-colors hover:border-rule-strong"
                    required
                  />
                </div>
                {login.isError && (
                  <p
                    role="alert"
                    className="rounded-xl border border-critical/30 bg-critical/8 px-3 py-2 text-sm text-critical"
                  >
                    {errorMessage(login.error)}
                  </p>
                )}
                <button
                  type="submit"
                  className="min-h-12 rounded-xl bg-accent px-4 py-2 font-semibold text-accent-ink shadow-[0_10px_28px_color-mix(in_srgb,var(--color-accent)_22%,transparent)] transition-all hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {login.isPending ? "Signing in…" : "Sign in"}
                </button>
              </fieldset>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
