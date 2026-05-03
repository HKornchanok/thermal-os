import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { useEffect, type ReactNode } from "react";

import { LoadingState } from "@/components/dashboard/states";

/**
 * Client-side auth guard for every protected route.
 *
 * Wraps the Layout in `_app.tsx`. When the session is loading, shows a
 * neutral spinner so the page chrome doesn't pop in before we know
 * whether the user is signed in. When unauthenticated, redirects to
 * `/login` and renders nothing — without this, every protected page
 * renders the layout shell and then fires API calls that 401, which
 * is exactly the bug the design audit caught.
 *
 * `/login` opts out via `_app.tsx`'s NO_LAYOUT_ROUTES set, so this
 * never wraps the sign-in page itself.
 *
 * Why client-side and not `getServerSideProps`: NextAuth stores the
 * session in an httpOnly cookie that's available to the server, but
 * each protected page would need its own getServerSideProps wrapper.
 * A single client-side gate at the layout level keeps the auth logic
 * in one place — and the dashboard's data is fetched client-side via
 * TanStack Query anyway, so the SSR HTML wouldn't carry user data.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      // Preserve the originally-requested URL so we can bounce back
      // after sign-in. NextAuth's signIn() supports `callbackUrl`;
      // the login page reads this query param.
      const callbackUrl = router.asPath;
      router.replace({
        pathname: "/login",
        query: callbackUrl !== "/" ? { callbackUrl } : undefined,
      });
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingState message="Loading session…" testId="auth-loading" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    // Render nothing while the redirect runs.
    return null;
  }

  return <>{children}</>;
}
