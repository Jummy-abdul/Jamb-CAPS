/**
 * LOCAL TEST IDENTITY PROVIDER — development and automated testing only.
 *
 * A standards-compliant OpenID Provider (panva/oidc-provider) used to exercise
 * CAPS's OIDC client end-to-end without access to Fixiam. It is NOT Fixiam and
 * makes no claims about Fixiam's behaviour. Never deploy it.
 *
 * Any login name is accepted on the interactive login screen; the account's
 * email / preferred_username are derived from it (e.g. "amina" → amina@demo.example).
 *
 * Usage: node scripts/dev-idp.mjs   (listens on http://localhost:4400)
 */
import Provider from "oidc-provider";

const PORT = Number(process.env.DEV_IDP_PORT ?? 4400);
const ISSUER = `http://localhost:${PORT}`;
const APP = process.env.DEV_APP_URL ?? "http://localhost:3000";

const provider = new Provider(ISSUER, {
  clients: [
    {
      client_id: "caps-local",
      client_secret: "caps-local-secret-for-dev-idp-only",
      redirect_uris: [`${APP}/api/auth/callback`],
      post_logout_redirect_uris: [`${APP}/login`],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
    },
  ],
  pkce: { required: () => true },
  claims: { openid: ["sub"], email: ["email", "email_verified"], profile: ["name", "given_name", "family_name", "preferred_username"] },
  features: { devInteractions: { enabled: true }, rpInitiatedLogout: { enabled: true } },
  conformIdTokenClaims: false, // include profile/email claims in the ID token
  cookies: { keys: ["dev-idp-cookie-key-not-secret"] },
  async findAccount(_ctx, id) {
    const login = String(id).toLowerCase().replace(/[^a-z0-9.@_-]/g, "");
    const local = login.includes("@") ? login.split("@")[0] : login;
    const email = login.includes("@") ? login : `${login}@demo.example`;
    const given = local.charAt(0).toUpperCase() + local.slice(1);
    return {
      accountId: String(id),
      async claims() {
        return { sub: String(id), email, email_verified: true, preferred_username: email, given_name: given, family_name: "Tester", name: `${given} Tester` };
      },
    };
  },
});
provider.proxy = true;
provider.on("server_error", (_ctx, err) => console.error("[dev-idp] server_error", err));
provider.listen(PORT, () => console.log(`[dev-idp] Local TEST OpenID Provider at ${ISSUER} (not Fixiam)`));
