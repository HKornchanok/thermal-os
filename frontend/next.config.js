/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://backend:8000";
    // `fallback` rewrites run AFTER both static and dynamic file routes.
    // NextAuth's catch-all (pages/api/auth/[...nextauth].ts) is dynamic, so
    // putting the proxy in `fallback` lets /api/auth/* resolve locally first
    // and every other /api/* path drop through to Django.
    return {
      fallback: [
        { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
      ],
    };
  },
};

module.exports = nextConfig;
