import NextAuth, { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";

// Mirrors backend SIMPLE_JWT.ACCESS_TOKEN_LIFETIME (30 minutes).
const ACCESS_TOKEN_LIFETIME_MS = 30 * 60 * 1000;
// Refresh proactively this many ms before expiry to absorb clock skew /
// in-flight requests.
const REFRESH_BUFFER_MS = 60 * 1000;

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: token.refreshToken }),
    });
    if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
    const data = (await res.json()) as { access: string };
    return {
      ...token,
      accessToken: data.access,
      accessTokenExpires: Date.now() + ACCESS_TOKEN_LIFETIME_MS,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        const res = await fetch(`${BACKEND_URL}/api/auth/token/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: credentials.username,
            password: credentials.password,
          }),
        });

        if (!res.ok) return null;
        const tokens = (await res.json()) as { access: string; refresh: string };

        return {
          id: credentials.username,
          name: credentials.username,
          accessToken: tokens.access,
          refreshToken: tokens.refresh,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Initial sign in — copy the tokens from authorize() onto the JWT.
      if (user) {
        token.accessToken = (user as { accessToken?: string }).accessToken;
        token.refreshToken = (user as { refreshToken?: string }).refreshToken;
        token.accessTokenExpires = Date.now() + ACCESS_TOKEN_LIFETIME_MS;
        token.username = user.name ?? null;
        return token;
      }

      // Subsequent calls — return the stored token unless it's near expiry.
      if (
        typeof token.accessTokenExpires === "number" &&
        Date.now() < token.accessTokenExpires - REFRESH_BUFFER_MS
      ) {
        return token;
      }

      // Access expired — try refresh.
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      if (session.user) {
        session.user.name = token.username ?? session.user.name ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
