import { useEffect, useState } from "react";
import App from "../App.jsx";
import { LoginPage, Wordmark } from "./LoginPage.jsx";
import { RecipientPortal } from "../views/RecipientPortal.jsx";
import {
  initializeIdentity,
  signIn,
  signInDoor,
  signOut,
} from "./session.js";

export function AuthGate() {
  const [door] = useState(signInDoor);
  const [identity, setIdentity] = useState({
    loading: true,
    config: null,
    principal: null,
    loginError: null,
  });

  useEffect(() => {
    initializeIdentity()
      .then(({ config, principal, loginError }) => {
        setIdentity({ loading: false, config, principal, loginError: loginError || null });
      })
      .catch(() => {
        setIdentity({ loading: false, config: null, principal: null, loginError: { code: "unavailable" } });
      });
  }, []);

  const signedIn = (principal) => {
    setIdentity((value) => ({ ...value, principal, loginError: null }));
  };

  // Local development previews and the workspace's own Microsoft Entra tenant.
  const workspaceSignIn = async (role) => {
    try {
      const principal = await signIn(role);
      if (principal) signedIn(principal);
    } catch {
      setIdentity((value) => ({ ...value, loginError: { code: "unavailable" } }));
    }
  };

  const logout = async () => {
    await signOut();
    setIdentity((value) => ({ ...value, principal: null }));
  };

  if (identity.loading) {
    return (
      <div className="auth-loading" role="status">
        <Wordmark />
        <p>Opening your workspace…</p>
      </div>
    );
  }
  if (!identity.principal) {
    return (
      <LoginPage
        // Remount when an error arrives so each door starts from its first step.
        key={identity.loginError?.code || "sign-in"}
        door={door}
        config={identity.config}
        initialError={identity.loginError}
        onSignedIn={signedIn}
        onWorkspaceSignIn={workspaceSignIn}
      />
    );
  }
  if (identity.principal.role === "client_contributor") {
    return <RecipientPortal principal={identity.principal} onSignOut={logout} />;
  }
  return <App principal={identity.principal} onSignOut={logout} />;
}
