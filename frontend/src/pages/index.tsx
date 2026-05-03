import Head from "next/head";
import { signOut, useSession } from "next-auth/react";
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
    return <p style={{ padding: 24, fontFamily: "system-ui" }}>Loading…</p>;
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
      <main
        style={{
          maxWidth: 640,
          margin: "10vh auto",
          padding: 24,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          color: "#e6edf3",
          background: "#0f1419",
          minHeight: "100vh",
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ marginTop: 0 }}>ThermalOS</h1>
        <p data-testid="signed-in-as">
          Signed in as <strong>{session.user?.name}</strong>.
        </p>

        <section
          style={{
            background: "#1a2028",
            border: "1px solid #303942",
            borderRadius: 8,
            padding: 16,
            margin: "16px 0",
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 14, opacity: 0.8 }}>
            Auth proof
          </h2>
          <p style={{ fontSize: 13, margin: "4px 0" }}>
            <strong>accessToken:</strong>{" "}
            <code data-testid="access-token-preview">{accessPreview}</code>
          </p>
          {session.error && (
            <p style={{ color: "#ff6b6b", fontSize: 13 }}>
              Token error: <code>{session.error}</code>
            </p>
          )}
        </section>

        <button
          data-testid="signout"
          onClick={() => signOut({ callbackUrl: "/login" })}
          style={{
            padding: "8px 14px",
            background: "transparent",
            color: "#e6edf3",
            border: "1px solid #303942",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </main>
    </>
  );
}
