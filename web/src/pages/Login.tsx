import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../lib/api";
import { useLogin } from "../lib/queries";

/**
 * The error message deliberately does not distinguish a wrong username from a
 * wrong password — the API compares both in constant time and returns one
 * code either way, so the interface must not hand back what the backend
 * spent effort withholding.
 */
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
    login.mutate({ username, password }, { onSuccess: () => navigate("/app") });
  }

  return (
    <main className="grid min-h-full place-items-center p-8">
      <div className="w-full max-w-sm rounded-lg border border-rule bg-surface-raised p-8">
        <h1 className="font-display text-2xl text-ink">Sign in</h1>
        <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
          <fieldset className="flex flex-col gap-4" disabled={login.isPending}>
            <div className="flex flex-col gap-1">
              <label htmlFor="username" className="text-sm text-ink-muted">
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="rounded border border-rule bg-surface px-3 py-2 text-ink"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="password" className="text-sm text-ink-muted">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="rounded border border-rule bg-surface px-3 py-2 text-ink"
                required
              />
            </div>
            {login.isError && (
              <p role="alert" className="text-sm text-critical">
                {errorMessage(login.error)}
              </p>
            )}
            <button
              type="submit"
              className="rounded bg-accent px-4 py-2 font-medium text-accent-ink"
            >
              {login.isPending ? "Signing in…" : "Sign in"}
            </button>
          </fieldset>
        </form>
      </div>
    </main>
  );
}
