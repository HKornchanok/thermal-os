import Head from "next/head";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return <p className="p-6 text-muted-foreground">Loading…</p>;
  }
  if (!session) return null;

  // Display only the head and tail of the access token — enough to confirm
  // it's present without spilling the whole bearer in screenshots.
  const access = session.accessToken ?? "";
  const accessPreview = access ? `${access.slice(0, 12)}…${access.slice(-12)}` : "(none)";

  return (
    <>
      <Head>
        <title>Overview · ThermalOS</title>
      </Head>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mt-0 text-2xl font-semibold">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="signed-in-as">
          Signed in as <strong className="text-foreground">{session.user?.name}</strong>.
        </p>

        <section className="mt-6 rounded-lg border border-border bg-card p-4 text-card-foreground">
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

        <p className="mt-6 text-xs text-muted-foreground">
          KPI cards, alert banner, and machine grid land in a later PR. This is
          the Overview placeholder for now.
        </p>
      </div>
    </>
  );
}
