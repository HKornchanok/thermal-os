import Head from "next/head";
import { signIn } from "next-auth/react";
import { useRouter } from "next/router";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Login() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("Invalid username or password.");
      return;
    }
    if (res?.ok) {
      // Bounce to the originally-requested URL the AuthGate captured,
      // falling back to the Overview page when the user came straight
      // to /login.
      const callback = router.query.callbackUrl;
      const target =
        typeof callback === "string" && callback.startsWith("/")
          ? callback
          : "/";
      router.push(target);
    }
  }

  return (
    <>
      <Head>
        <title>Sign in · ThermalOS</title>
      </Head>
      <main className="relative grid min-h-screen place-items-center bg-background text-foreground">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <form
          onSubmit={onSubmit}
          className="flex w-80 flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm"
        >
          <h1 className="m-0 text-xl font-semibold">ThermalOS</h1>
          <p className="m-0 text-xs text-muted-foreground">
            Sign in with the seeded admin account.
          </p>

          <label className="flex flex-col gap-1 text-xs">
            Username
            <input
              data-testid="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="rounded-md border border-input bg-background px-2.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            Password
            <input
              data-testid="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="rounded-md border border-input bg-background px-2.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>

          <Button
            data-testid="submit"
            type="submit"
            disabled={loading}
            className="font-semibold"
          >
            {loading ? "Signing in…" : "Sign in"}
          </Button>

          {error && (
            <p data-testid="error" className="m-0 text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      </main>
    </>
  );
}
