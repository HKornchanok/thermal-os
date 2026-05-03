import Head from "next/head";
import { signIn } from "next-auth/react";
import { useRouter } from "next/router";
import { useState, type FormEvent } from "react";

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
      router.push("/");
    }
  }

  return (
    <>
      <Head>
        <title>Sign in · ThermalOS</title>
      </Head>
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#0f1419",
          color: "#e6edf3",
        }}
      >
        <form
          onSubmit={onSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            width: 320,
            padding: 24,
            background: "#1a2028",
            borderRadius: 8,
            border: "1px solid #303942",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22 }}>ThermalOS</h1>
          <p style={{ margin: 0, opacity: 0.7, fontSize: 13 }}>
            Sign in with the seeded admin account.
          </p>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Username
            <input
              data-testid="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              style={inputStyle}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
            Password
            <input
              data-testid="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={inputStyle}
            />
          </label>

          <button
            data-testid="submit"
            type="submit"
            disabled={loading}
            style={{
              padding: "10px 12px",
              background: loading ? "#2d6a3a" : "#3fb95e",
              color: "#0f1419",
              border: 0,
              borderRadius: 6,
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          {error && (
            <p data-testid="error" style={{ color: "#ff6b6b", fontSize: 13, margin: 0 }}>
              {error}
            </p>
          )}
        </form>
      </main>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "#0f1419",
  color: "#e6edf3",
  border: "1px solid #303942",
  borderRadius: 6,
  fontSize: 14,
};
