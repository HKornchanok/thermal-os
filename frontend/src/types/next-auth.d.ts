import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    // Today the only error code we set is RefreshAccessTokenError. Keep
    // the union strict so consumers get autocomplete + safety on the
    // expected codes; widen here if more are added.
    error?: "RefreshAccessTokenError";
  }

  interface User {
    accessToken?: string;
    refreshToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    username?: string | null;
    error?: "RefreshAccessTokenError";
  }
}
