/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Django expects trailing slashes on /api/* (`APPEND_SLASH = True` is the
  // Django default). Without this flag, Next.js's default behaviour 308-
  // redirects `/api/decisions/` to `/api/decisions`, which bypasses the
  // rewrite and never reaches Django. Keep slashes as the client sent them.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://backend:8000";
    // `fallback` rewrites run AFTER both static and dynamic file routes.
    // NextAuth's catch-all (pages/api/auth/[...nextauth].ts) is dynamic, so
    // putting the proxy in `fallback` lets /api/auth/* resolve locally first
    // and every other /api/* path drop through to Django.
    //
    // Note the trailing slash on the destination: `:path*` does NOT preserve
    // a trailing slash from the source, so `/api/decisions/` would otherwise
    // proxy to `http://backend:8000/api/decisions` (no slash). Django's
    // APPEND_SLASH then 301s back to the slash version → loop. Appending
    // `/` here keeps Django happy without forcing the client to drop slashes.
    return {
      fallback: [
        { source: "/api/:path*", destination: `${backendUrl}/api/:path*/` },
      ],
    };
  },
};

module.exports = nextConfig;
