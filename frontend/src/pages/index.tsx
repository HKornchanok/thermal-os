import Head from "next/head";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <p className="p-6 text-muted-foreground">Loading…</p>
    );
  }
  if (!session) return null;

  // Display only the head and tail of the access token — enough to confirm
  // it's present without spilling the whole bearer in screenshots.
  const access = session.accessToken ?? "";
  const accessPreview = access ? `${access.slice(0, 12)}…${access.slice(-12)}` : "(none)";

  return (
    <>
      <Head>
        <title>ThermalOS</title>
      </Head>
      <main className="mx-auto box-border min-h-screen max-w-2xl px-6 py-20 text-foreground">
        <h1 className="mt-0 text-2xl font-semibold">ThermalOS</h1>
        <p data-testid="signed-in-as">
          Signed in as <strong>{session.user?.name}</strong>.
        </p>

        <section className="my-4 rounded-lg border border-border bg-card p-4 text-card-foreground">
          <h2 className="mt-0 text-sm font-medium text-muted-foreground">Auth proof</h2>
          <p className="my-1 text-xs">
            <strong>accessToken:</strong>{" "}
            <code data-testid="access-token-preview" className="font-mono">
              {accessPreview}
            </code>
          </p>
          {session.error && (
            <p className="text-xs text-destructive">
              Token error: <code className="font-mono">{session.error}</code>
            </p>
          )}
        </section>

        <div className="flex items-center gap-2">
          <Button
            data-testid="signout"
            variant="outline"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            Sign out
          </Button>
          <ThemeToggle />
        </div>
      </main>
    </>
  );
}
