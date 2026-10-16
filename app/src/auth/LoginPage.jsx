import { useEffect, useRef, useState } from "react";
import { PRODUCT_NAME } from "../config/product.js";
import { StoryArt } from "./StoryArt.jsx";
import {
  discoverEmail,
  doorUrl,
  requestPasswordReset,
  resetPassword,
  sendEmailCode,
  signInWithPassword,
  signUpWithPassword,
  startProviderSignIn,
  takeResetToken,
  verifyEmailCode,
} from "./session.js";

const MIN_PASSWORD_LENGTH = 10;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const PROVIDER_FAILURE = "We couldn't finish signing in with that provider. Try again, or use an emailed link.";

const MESSAGES = {
  invalid_credentials: `That email and password don't match a ${PRODUCT_NAME} account.`,
  email_already_registered: "An account already uses this email. Sign in instead.",
  passwords_differ: "Those passwords don't match.",
  reset_link_expired: "That link has expired or was already used. Request a new one below.",
  already_invited: "You've already been invited to a workspace with this email. Sign in instead to accept it.",
  weak_password: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
  too_many_attempts: "Too many attempts. Wait a few minutes, then try again.",
  signup_disabled: "New firm accounts are not being accepted right now.",
  invalid_code: "That code is incorrect or has expired. Request a new one.",
  sign_in_expired: "That sign-in link has expired or was already used. Enter your email to get a new one.",
  sign_in_cancelled: "Sign-in was cancelled.",
  organization_name_required: "Enter your firm's name first.",
  provider_not_available: "That sign-in option isn't available.",
  sso_not_configured: "Your firm hasn't connected its sign-in provider yet.",
  provider_unreachable: PROVIDER_FAILURE,
  provider_misconfigured: PROVIDER_FAILURE,
  invalid_id_token: PROVIDER_FAILURE,
  code_exchange_failed: PROVIDER_FAILURE,
};

/* Turns a sign-in failure into words, plus a link to the other door when the
   person simply came in the wrong one. */
function describe(error, door) {
  if (!error) return null;
  const code = error.code || error;
  if (code === "wrong_portal") {
    return door === "firm"
      ? { text: "That email is set up for the client portal.", link: { door: "client", label: "Go to the client portal" } }
      : { text: "That email belongs to a grant adviser's firm workspace.", link: { door: "firm", label: "Go to the firm sign-in" } };
  }
  if (code === "no_account") {
    return {
      text: door === "firm"
        ? `There's no ${PRODUCT_NAME} account for that email yet. Ask your firm's administrator to invite you.`
        : "We couldn't find a client account for that email. Ask your grant adviser to invite you.",
    };
  }
  if (code === "email_not_verified") {
    return { text: "That account didn't confirm your email address to us. Try an emailed sign-in link instead." };
  }
  if (code === "sso_required") {
    return { text: `Your firm signs in with ${error.provider || "its own sign-in provider"}.` };
  }
  if (code === "unavailable") return { text: `${PRODUCT_NAME} can't be reached right now. Try again shortly.` };
  if (error.status === 422) return { text: "Check the details you entered and try again." };
  return { text: MESSAGES[code] || "Sign-in is temporarily unavailable. Try again shortly." };
}

/* A request that never reached the server, or a server fault: worth a retry. */
const isNetworkFailure = (error) => !error?.status || error.status >= 500;

export function LoginPage({ config, door, initialError, onSignedIn, onWorkspaceSignIn }) {
  return door === "client"
    ? <ClientDoor config={config} initialError={initialError} onSignedIn={onSignedIn} onWorkspaceSignIn={onWorkspaceSignIn} />
    : <SignInDoor config={config} initialError={initialError} onSignedIn={onSignedIn} onWorkspaceSignIn={onWorkspaceSignIn} />;
}

/* ---------------- the main sign-in page: one email field for everyone ---------------- */

function SignInDoor({ config, initialError, onSignedIn, onWorkspaceSignIn }) {
  // Firm sign-up has no link on this page; it stays reachable at ?signup.
  const [resetToken] = useState(takeResetToken);
  const [step, setStep] = useState(() => (
    resetToken ? "reset" : new URLSearchParams(window.location.search).has("signup") ? "signup" : "email"
  ));
  const [email, setEmail] = useState("");
  const [error, setError] = useState(initialError || null);

  const developer = config?.mode === "development" && (
    <DevelopmentEntry onWorkspaceSignIn={onWorkspaceSignIn} roles={[
      ["administrator", "Local administrator"],
      ["grant_adviser", "Grant adviser preview"],
      ["client_contributor", "Client portal preview"],
    ]} />
  );
  const restart = () => {
    setStep("email");
    setError(null);
  };

  if (step === "signup") {
    return (
      <Shell title="Create your firm's workspace"
        lede="You'll be its administrator. Once you're in, invite your grant advisers and your clients."
        error={describe(error, "firm")}
        footer={<p className="login-switch">Already have an account? <button type="button" className="btn-text login-link" onClick={restart}>Sign in</button></p>}>
        <CreateFirm config={config} onSignedIn={onSignedIn} onError={setError} />
      </Shell>
    );
  }

  if (step === "reset") {
    return (
      <Shell title="Choose a password" lede="You'll use it with your email to sign in from now on."
        error={describe(error, "firm")} developer={developer}
        footer={<p className="login-switch"><button type="button" className="btn-text login-link" onClick={() => { setError(null); setStep("forgot"); }}>Send me a new link</button></p>}>
        <ChoosePassword token={resetToken} onSignedIn={onSignedIn} onError={setError} />
      </Shell>
    );
  }

  if (step === "forgot") {
    return (
      <Shell title="Reset your password" lede="Enter your email and we'll send you a link to choose a new one."
        error={describe(error, "firm")} developer={developer}
        footer={<p className="login-switch"><button type="button" className="btn-text login-link" onClick={restart}>Back to sign in</button></p>}>
        <EmailForm
          email={email}
          onEmailChange={setEmail}
          onError={setError}
          buttonLabel="Send reset link"
          submit={async (value) => {
            await requestPasswordReset(value);
            setStep("forgot-sent");
            return "sent";
          }}
        />
      </Shell>
    );
  }

  if (step === "forgot-sent") {
    return (
      <Shell title="Check your inbox" developer={developer}
        footer={<p className="login-switch"><button type="button" className="btn-text login-link" onClick={restart}>Back to sign in</button></p>}>
        <p className="login-sent">If there's an account for <b>{email}</b>, a link to reset your password is on its way.</p>
        <p className="login-hint">It works once and expires in an hour. If your firm signs in with SSO, use that instead.</p>
      </Shell>
    );
  }

  return (
    <Shell title="Sign in" lede="Enter your email and password." error={describe(error, "firm")} developer={developer}
      footer={config?.signupEnabled && (
        <p className="login-switch">New to {PRODUCT_NAME}? <button type="button" className="btn-text login-link" onClick={() => { setError(null); setStep("signup"); }}>Create an account</button></p>
      )}>
      <PasswordSignIn
        email={email}
        onEmailChange={setEmail}
        onSignedIn={onSignedIn}
        onError={setError}
        onForgot={() => { setError(null); setStep("forgot"); }}
      />
      <div className="login-divider" role="separator"><span>or continue with</span></div>
      <OrganisationSignIn config={config} onWorkspaceSignIn={onWorkspaceSignIn} />
    </Shell>
  );
}

/* The default: email and password. */
function PasswordSignIn({ email, onEmailChange, onSignedIn, onError, onForgot }) {
  const [password, setPassword] = useState("");
  const [state, setState] = useState("idle"); // idle | signing-in
  const [fieldError, setFieldError] = useState("");
  const [networkError, setNetworkError] = useState(null); // the action to retry

  const validEmail = () => {
    if (EMAIL_PATTERN.test(email.trim())) return true;
    setFieldError("Enter a valid email address, like name@company.com.au.");
    return false;
  };
  const run = async (busy, task) => {
    setFieldError("");
    setNetworkError(null);
    onError(null);
    setState(busy);
    try {
      await task();
    } catch (reason) {
      if (isNetworkFailure(reason)) setNetworkError(() => () => run(busy, task));
      else onError(reason);
    } finally {
      setState("idle");
    }
  };

  const signIn = (event) => {
    event.preventDefault();
    if (!validEmail()) return;
    run("signing-in", async () => onSignedIn(await signInWithPassword({ email: email.trim(), password })));
  };

  return (
    <form className="login-form" noValidate onSubmit={signIn}>
      <label>
        <span>Email</span>
        <input type="email" name="email" autoComplete="username" inputMode="email" maxLength={254} autoFocus
          value={email} onChange={(event) => { onEmailChange(event.target.value); setFieldError(""); }}
          aria-invalid={fieldError ? "true" : undefined}
          aria-describedby={fieldError ? "email-error" : undefined} />
      </label>
      {fieldError && <p id="email-error" className="login-field-error" role="alert">{fieldError}</p>}
      <div className="login-password">
        <label htmlFor="login-password">Password</label>
        <button type="button" className="btn-text" onClick={onForgot}>Forgot password?</button>
        <input id="login-password" type="password" name="password" autoComplete="current-password"
          maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      <button type="submit" className="btn-primary login-action" disabled={state !== "idle"} aria-busy={state === "signing-in"}>
        {state === "signing-in" && <span className="login-spinner" aria-hidden="true" />}
        {state === "signing-in" ? "Signing in…" : "Sign in"}
      </button>
      {networkError && (
        <p className="login-error" role="alert">
          We couldn't reach {PRODUCT_NAME}. Check your connection, then{" "}
          <button type="button" className="btn-text login-retry" onClick={networkError}>try again</button>.
        </p>
      )}
    </form>
  );
}

/* Set a password from a reset or invitation link, then sign straight in. */
function ChoosePassword({ token, onSignedIn, onError }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [working, setWorking] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      onError({ code: "weak_password" });
      return;
    }
    if (password !== confirm) {
      onError({ code: "passwords_differ" });
      return;
    }
    setWorking(true);
    onError(null);
    try {
      onSignedIn(await resetPassword(token, password));
    } catch (reason) {
      onError(reason);
      setWorking(false);
    }
  };
  return (
    <form className="login-form" onSubmit={submit}>
      <label>
        <span>New password</span>
        <input required type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={256} autoFocus
          aria-describedby="new-password-hint" value={password} onChange={(event) => setPassword(event.target.value)} />
        <small id="new-password-hint">At least {MIN_PASSWORD_LENGTH} characters.</small>
      </label>
      <label>
        <span>Confirm password</span>
        <input required type="password" autoComplete="new-password" maxLength={256}
          value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      </label>
      <button type="submit" className="btn-primary login-action" disabled={working}>
        {working ? "Saving…" : "Save and sign in"}
      </button>
    </form>
  );
}

/* Work accounts in one compact row: Google, Microsoft, or the firm's own
   SSO. Choosing SSO swaps the row for a work-email field. */
function OrganisationSignIn({ config, onWorkspaceSignIn }) {
  const [sso, setSso] = useState(false);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const providers = config?.providers || [];
  const workspaceMicrosoft = config?.mode === "entra" && config.clientId
    && !providers.some((provider) => provider.key === "microsoft");

  if (sso) {
    return (
      <div className="login-org-sso">
        <EmailForm
          email={email}
          onEmailChange={(value) => { setEmail(value); setNotice(""); }}
          onError={() => {}}
          label="Work email"
          quiet
          buttonLabel="Continue with SSO"
          submit={async (value) => {
            const found = await discoverEmail(value);
            if (found.route === "sso") {
              startProviderSignIn("sso", "firm", { email: value });
              return "leaving";
            }
            setNotice(`Single sign-on isn't set up for ${value.split("@")[1]}. Use your email and password, or ask your administrator.`);
            return "done";
          }}
        />
        {notice && <p className="login-hint login-org-notice" role="status">{notice}</p>}
        <p className="login-switch login-switch-left">
          <button type="button" className="btn-text" onClick={() => { setSso(false); setNotice(""); }}>Back to other options</button>
        </p>
      </div>
    );
  }

  return (
    <div className="login-provider-strip">
      {providers.map((provider) => (
        <ProviderChip key={provider.key} provider={provider}
          onClick={() => startProviderSignIn(provider.key, "firm")} />
      ))}
      {workspaceMicrosoft && (
        <ProviderChip provider={{ key: "microsoft", label: "Microsoft" }}
          onClick={() => onWorkspaceSignIn("administrator")} />
      )}
      <button type="button" className="login-chip" aria-label="Continue with your organisation's SSO" onClick={() => setSso(true)}>
        <KeyGlyph /><span>SSO</span>
      </button>
    </div>
  );
}

function ProviderChip({ provider, onClick, verb = "Continue" }) {
  return (
    <button type="button" className="login-chip" aria-label={`${verb} with ${provider.label}`} onClick={onClick}>
      <ProviderGlyph provider={provider.key} /><span>{provider.label}</span>
    </button>
  );
}

/* Email field with its own loading, validation and network-failure states. */
function EmailForm({ email, onEmailChange, onError, helper, submit, buttonLabel = "Continue", label = "Email", quiet = false }) {
  const [state, setState] = useState("idle"); // idle | working | leaving
  const [fieldError, setFieldError] = useState("");
  const [networkError, setNetworkError] = useState(false);

  const attempt = async () => {
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setFieldError("Enter a valid email address, like name@company.com.au.");
      return;
    }
    setFieldError("");
    setNetworkError(false);
    onError(null);
    setState("working");
    try {
      const outcome = await submit(value);
      // Stay busy while the browser leaves for the firm's sign-in page.
      setState(outcome === "leaving" ? "leaving" : "idle");
    } catch (reason) {
      setState("idle");
      if (isNetworkFailure(reason)) setNetworkError(true);
      else onError(reason);
    }
  };

  const busy = state !== "idle";
  return (
    <form className="login-form" noValidate onSubmit={(event) => { event.preventDefault(); attempt(); }}>
      <label>
        <span>{label}</span>
        <input type="email" name="email" autoComplete="email" inputMode="email" maxLength={254} autoFocus
          value={email} onChange={(event) => { onEmailChange(event.target.value); setFieldError(""); }}
          aria-invalid={fieldError ? "true" : undefined}
          aria-describedby={fieldError ? "email-error" : "email-help"} />
      </label>
      {fieldError && <p id="email-error" className="login-field-error" role="alert">{fieldError}</p>}
      <button type="submit" className={`${quiet ? "btn-secondary" : "btn-primary"} login-action`} disabled={busy} aria-busy={busy}>
        {busy && <span className="login-spinner" aria-hidden="true" />}
        {state === "leaving" ? "Taking you to your organisation…" : busy ? "Checking…" : buttonLabel}
      </button>
      {networkError && (
        <p className="login-error" role="alert">
          We couldn't reach {PRODUCT_NAME}. Check your connection, then{" "}
          <button type="button" className="btn-text login-retry" onClick={attempt}>try again</button>.
        </p>
      )}
      {helper && <p id="email-help" className="login-hint">{helper}</p>}
    </form>
  );
}

/* The same answer whether or not the email has an account. */
function SentConfirmation({ email, audience, onSignedIn, onBack }) {
  return (
    <>
      <p className="login-sent">
        If you've been invited to a grant workspace, a sign-in link is on its way to <b>{email}</b>.
      </p>
      <p className="login-hint">Not seeing it? Ask your grant adviser to add you.</p>
      <CodeEntry email={email} audience={audience} onSignedIn={onSignedIn} />
      <p className="login-switch login-switch-left">
        <button type="button" className="btn-text" onClick={onBack}>Use a different email</button>
      </p>
    </>
  );
}

/* The emailed message also carries a 6-digit code, for a different device. */
function CodeEntry({ email, audience, onSignedIn }) {
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (event) => {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      onSignedIn(await verifyEmailCode(email, audience, code));
    } catch (reason) {
      setError(reason);
      setWorking(false);
    }
  };
  return (
    <form className="login-form login-code-form" onSubmit={submit}>
      <label>
        <span>Or enter the 6-digit code from the email</span>
        <span className="login-code-row">
          <input required className="login-code" inputMode="numeric" autoComplete="one-time-code"
            pattern="\d{6}" maxLength={6} value={code} aria-label="Sign-in code"
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
          <button type="submit" className="btn-secondary" disabled={working || code.length !== 6}>
            {working ? "Signing in…" : "Sign in"}
          </button>
        </span>
      </label>
      {error && <p className="login-field-error" role="alert">{describe(error, audience || "firm").text}</p>}
    </form>
  );
}

/* Roles are never self-chosen: creating an account makes a new firm with
   you as its administrator; advisers and clients are invited instead.
   Two short steps: the firm, then how you'll sign in. */
function CreateFirm({ config, onSignedIn, onError }) {
  const [step, setStep] = useState("firm");
  const [form, setForm] = useState({ organizationName: "", displayName: "", email: "", password: "" });
  const [working, setWorking] = useState(false);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const providers = config?.providers || [];

  const next = (event) => {
    event.preventDefault();
    onError(null);
    setStep("access");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      onError({ code: "weak_password" });
      return;
    }
    setWorking(true);
    onError(null);
    try {
      onSignedIn(await signUpWithPassword(form));
    } catch (reason) {
      onError(reason);
      setWorking(false);
    }
  };

  if (step === "firm") {
    return (
      <form className="login-form" onSubmit={next}>
        <label>
          <span>Firm name</span>
          <input required autoComplete="organization" maxLength={120} autoFocus
            value={form.organizationName} onChange={update("organizationName")} />
        </label>
        <label>
          <span>Your name</span>
          <input required autoComplete="name" maxLength={120}
            value={form.displayName} onChange={update("displayName")} />
        </label>
        <button type="submit" className="btn-primary login-action">Continue</button>
        <p className="login-hint">
          Joining a firm, or a client receiving a grant? You don't need to sign up here: look for the invitation in your email.
        </p>
      </form>
    );
  }

  return (
    <>
      <p className="login-email-chip">
        <span><b>{form.organizationName}</b> · {form.displayName}</span>
        <button type="button" className="btn-text" onClick={() => setStep("firm")}>Change</button>
      </p>
      <form className="login-form" onSubmit={submit}>
        <label>
          <span>Work email</span>
          <input required type="email" autoComplete="email" maxLength={254} autoFocus
            value={form.email} onChange={update("email")} />
        </label>
        <label>
          <span>Password</span>
          <input required type="password" minLength={MIN_PASSWORD_LENGTH} maxLength={256}
            autoComplete="new-password" aria-describedby="password-hint"
            value={form.password} onChange={update("password")} />
          <small id="password-hint">At least {MIN_PASSWORD_LENGTH} characters.</small>
        </label>
        <button type="submit" className="btn-primary login-action" disabled={working}>
          {working ? "Creating workspace…" : "Create workspace"}
        </button>
      </form>
      {providers.length > 0 && (
        <>
          <div className="login-divider" role="separator"><span>or sign up with</span></div>
          <div className="login-provider-strip">
            {providers.map((provider) => (
              <ProviderChip key={provider.key} provider={provider} verb="Create"
                onClick={() => startProviderSignIn(provider.key, "firm", {
                  intent: "signup",
                  organizationName: form.organizationName,
                  displayName: form.displayName,
                })} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* ---------------- client portal (/client/): where client invitations land ---------------- */

function ClientDoor({ config, initialError, onSignedIn, onWorkspaceSignIn }) {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(initialError || null);
  const developer = config?.mode === "development" && (
    <DevelopmentEntry onWorkspaceSignIn={onWorkspaceSignIn} roles={[["client_contributor", "Client portal preview"]]} />
  );

  if (step === "sent") {
    return (
      <Shell eyebrow="Client portal" title="Check your inbox" developer={developer}>
        <SentConfirmation email={email} audience="client" onSignedIn={onSignedIn}
          onBack={() => { setStep("email"); setError(null); }} />
      </Shell>
    );
  }

  return (
    <Shell eyebrow="Client portal" title="Sign in to your grant portal"
      lede="Use the work email your grant adviser has on file. We'll email you a secure sign-in link — no password needed."
      error={describe(error, "client")} developer={developer}
      footer={<p className="login-switch">Grant adviser or firm staff? <a href={doorUrl("firm")}>Sign in here</a></p>}>
      <EmailForm
        email={email}
        onEmailChange={setEmail}
        onError={setError}
        buttonLabel="Email me a sign-in link"
        submit={async (value) => {
          await sendEmailCode(value, "client");
          setStep("sent");
          return "sent";
        }}
      />
      <ProviderButtons config={config} audience="client" params={email ? { email } : {}} />
    </Shell>
  );
}

/* ---------------- shared pieces ---------------- */

function ProviderButtons({ config, audience, params = {} }) {
  const providers = config?.providers || [];
  if (!providers.length) return null;
  return (
    <>
      <div className="login-divider" role="separator"><span>or</span></div>
      <div className="login-provider-row">
        {providers.map((provider) => (
          <button key={provider.key} type="button" className="btn-secondary login-action"
            onClick={() => startProviderSignIn(provider.key, audience, params)}>
            <ProviderGlyph provider={provider.key} />Continue with {provider.label}
          </button>
        ))}
      </div>
    </>
  );
}

function DevelopmentEntry({ onWorkspaceSignIn, roles }) {
  return (
    <details className="login-dev">
      <summary>Developer shortcuts</summary>
      <div>
        {roles.map(([role, label]) => (
          <button key={role} type="button" className="btn-text" onClick={() => onWorkspaceSignIn(role)}>
            {label}
          </button>
        ))}
      </div>
    </details>
  );
}

function Shell({ eyebrow, title, lede, error, footer, developer, children }) {
  const errorRef = useRef(null);
  // On long forms the message sits above the button that caused it.
  useEffect(() => {
    errorRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [error?.text]);
  return (
    <main className="login-page">
      <section className="login-main" aria-labelledby="login-title">
        <header className="login-top"><Wordmark /></header>
        <div className="login-main-body">
          <div className="login-panel">
            <div className="login-copy">
              {eyebrow && <p className="login-eyebrow">{eyebrow}</p>}
              <h1 id="login-title">{title}</h1>
              {lede && <p className="login-lede">{lede}</p>}
            </div>
            {error && (
              <p className="login-error" role="alert" ref={errorRef}>
                {error.text}
                {error.link && <> <a href={doorUrl(error.link.door)}>{error.link.label}</a></>}
              </p>
            )}
            {children}
            {footer && <div className="login-panel-foot">{footer}</div>}
          </div>
          {developer}
        </div>
      </section>
      <StoryCarousel />
    </main>
  );
}

/* No logo yet: the product name stands in as a wordmark. */
export function Wordmark() {
  return <span className="wordmark">{PRODUCT_NAME}</span>;
}

/* ---------------- left panel: what the product does, as three cards ---------------- */

/* Each story shows a small, illustrative piece of the product, drawn with the
   design system rather than artwork. The figures are examples, not data. */
export const STORIES = [
  {
    key: "next-action",
    heading: "The grant assistant that tells your team what's next.",
    body: "Milestones, spend and evidence in one view, with a clear next action for every grant your team manages.",
  },
  {
    key: "team",
    heading: "Scale your grant portfolio with the team you have.",
    body: "Routine compliance work, simplified, with suggestions your whole team can act on together.",
  },
  {
    key: "portfolio",
    heading: "Keeping Australia's best ideas funded to the finish line",
    body: "From IGP to ARENA, every milestone delivered and every claim backed by evidence, so the funding keeps flowing to the work that matters.",
  },
];

const STORY_SECONDS = 7;

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return undefined;
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

/* Plays each story in turn. The active progress segment fills over
   STORY_SECONDS and advances when its fill finishes, so pausing (hover or
   focus) pauses both together. With reduced motion nothing moves on its own;
   the segments still switch stories when clicked. */
/* Plays the stories in turn, quietly: three dots show where you are and
   pick a story; hovering or focusing holds the current one. With reduced
   motion nothing changes on its own. */
function StoryCarousel() {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const playing = !reducedMotion && !held;
  const count = STORIES.length;

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % count), STORY_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, index, count]);

  return (
    <section className="login-stories" aria-roledescription="carousel" aria-label={`What ${PRODUCT_NAME} does`}
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      <div className="login-story-track" aria-live={playing ? "off" : "polite"}>
        {STORIES.map((story, position) => (
          <article key={story.key} className={position === index ? "login-story is-active" : "login-story"}
            role="group" aria-roledescription="slide" aria-label={`${position + 1} of ${count}`}
            aria-hidden={position !== index}>
            <div className="login-story-visual" aria-hidden="true">
              <StoryArt kind={story.key} />
            </div>
            <div className="login-story-text">
              <h2 className="login-story-heading">{story.heading}</h2>
              <p className="login-story-body">{story.body}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="login-story-dots">
        {STORIES.map((story, position) => (
          <button key={story.key} type="button" aria-label={`Show story ${position + 1} of ${count}`}
            aria-current={position === index ? "true" : undefined}
            className={position === index ? "is-active" : ""} onClick={() => setIndex(position)} />
        ))}
      </div>
    </section>
  );
}

function KeyGlyph() {
  return (
    <svg className="provider-glyph" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7" cy="10" r="3.5" />
      <path d="M10.5 10H17.5M15 10v2.5M17.5 10v2" />
    </svg>
  );
}

function ProviderGlyph({ provider }) {
  if (provider === "microsoft") {
    return <span className="ms-glyph" aria-hidden="true"><i /><i /><i /><i /></span>;
  }
  if (provider === "google") {
    return (
      <svg className="provider-glyph" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
        <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
      </svg>
    );
  }
  return null;
}
