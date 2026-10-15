import esriConfig from "@arcgis/core/config";
import IdentityManager from "@arcgis/core/identity/IdentityManager";
import OAuthInfo from "@arcgis/core/identity/OAuthInfo";
import Portal from "@arcgis/core/portal/Portal";
import { config } from "./config";

const sharingUrl = () => `${config.portalUrl}/sharing`;
const SESSION_KEY = "kawasan:arcgis-session";

/** Registers the OAuth app (ARCGIS_CLIENT_ID). Sign-in uses a popup; the redirect URI is oauth-callback.html. */
export function setupAuth(): boolean {
  // Never open the built-in username/password dialog; sign-in is explicit via signIn().
  esriConfig.request.useIdentity = false;
  if (!config.clientId) return false;
  const base = new URL(".", window.location.href).href;
  IdentityManager.registerOAuthInfos([
    new OAuthInfo({ appId: config.clientId, portalUrl: config.portalUrl, popup: true, popupCallbackUrl: `${base}oauth-callback.html` }),
  ]);
  // The SDK does not keep the session across page loads: restore it from sessionStorage (this tab only).
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      IdentityManager.initialize(JSON.parse(saved));
      // Restored session: use it from the first request, so the default portal (read by the AI
      // assistant) loads as the signed-in user.
      esriConfig.request.useIdentity = true;
    }
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
  }
  const persist = () => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(IdentityManager.toJSON()));
    } catch {
      /* storage unavailable */
    }
  };
  IdentityManager.on("credential-create", persist);
  return true;
}

/** True if a previous OAuth session is still valid (does not prompt). */
export async function isSignedIn(): Promise<boolean> {
  try {
    await IdentityManager.checkSignInStatus(sharingUrl());
    return true;
  } catch {
    return false;
  }
}

/** Username of the current ArcGIS session, or null when signed out. */
export function currentUser(): string | null {
  return IdentityManager.findCredential(sharingUrl())?.userId || null;
}

/** Ends the session (this tab) and reloads so every layer and the assistant start anonymous again. */
export function signOut(): void {
  IdentityManager.destroyCredentials();
  sessionStorage.removeItem(SESSION_KEY);
  window.location.reload();
}

/** Opens the OAuth popup (call from a click handler so it is not blocked). */
export async function signIn(): Promise<void> {
  esriConfig.request.useIdentity = true;
  await IdentityManager.getCredential(sharingUrl(), { oAuthPopupConfirmation: false });
  // The default portal is cached; if it loaded anonymously before sign-in it never gets a user.
  // Drop it so the next Portal.getDefault() (e.g. the AI assistant, created after this) is signed in.
  const portal = Portal.getDefault();
  if (portal.loaded && !portal.user) portal.destroy();
}
