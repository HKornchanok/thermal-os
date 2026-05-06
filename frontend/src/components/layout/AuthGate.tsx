import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { useEffect, type ReactNode } from "react";

import { LoadingState } from "@/components/dashboard/states";

/**
 * Client-side auth guard for every protected route. Layout is wrapped
 * in _app.tsx; /login opts out via NO_LAYOUT_ROUTES.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
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

  if (status === "unauthenticated") return null;

  return <>{children}</>;
}
