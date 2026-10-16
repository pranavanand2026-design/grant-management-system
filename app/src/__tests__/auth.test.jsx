import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "../auth/AuthGate.jsx";
import { browser } from "../auth/session.js";
import { DATA, session, state } from "../store.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function response(body, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

const PROVIDERS = [{ key: "google", label: "Google" }, { key: "microsoft", label: "Microsoft" }];

function principalFor(role, overrides = {}) {
  return {
    tenantId: "grantflow",
    objectId: role,
    email: `${role}@example.com`,
    displayName: role === "client_contributor" ? "Client User" : "Firm Admin",
    role,
    organizationId: 2,
    organizationName: "Acme Grants",
    microsoftIntegrations: false,
    clientName: role === "client_contributor" ? "Acme Robotics" : null,
    ...overrides,
  };
}

function sessionBody(principal, status = 200) {
  return response({
    token: "session-token",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    principal,
  }, status);
}

/* Server behaviour each test can adjust. */
let server;

function mockFetch(url, options = {}) {
  const path = String(url).replace(/^https?:\/\/[^/]+/, "");
  const body = options.body ? JSON.parse(options.body) : {};
  if (path.endsWith("/auth/config")) {
    return response({ mode: "development", scopes: [], signupEnabled: true, providers: PROVIDERS });
  }
  if (path.endsWith("/auth/discover")) {
    if (server.offline) return Promise.reject(new TypeError("Failed to fetch"));
    return response(server.sso
      ? { route: "sso", sso: { key: "sso", label: "Acme Okta" }, ssoRequired: server.ssoRequired }
      : { route: "magic_link", sso: null, ssoRequired: false });
  }
  if (path.endsWith("/auth/email-code")) {
    if (server.offline) return Promise.reject(new TypeError("Failed to fetch"));
    return response({ sent: true }, 202);
  }
  if (path.endsWith("/auth/email-code/verify")) {
    if (body.code !== "123456") return response({ detail: { code: "invalid_code" } }, 401);
    return sessionBody(principalFor(body.audience === "client" || body.email.startsWith("client") ? "client_contributor" : "grant_adviser"));
  }
  if (path.endsWith("/auth/password/forgot")) return response({ sent: true }, 202);
  if (path.endsWith("/auth/password/reset")) {
    if (body.token !== "good-token") return response({ detail: { code: "reset_link_expired" } }, 400);
    return sessionBody(principalFor("grant_adviser"));
  }
  if (path.endsWith("/auth/exchange")) return sessionBody(principalFor("client_contributor"));
  if (path.endsWith("/auth/signup")) {
    return sessionBody(principalFor("administrator", { organizationName: body.organizationName, displayName: body.displayName }), 201);
  }
  if (path.endsWith("/auth/login")) {
    if (server.offline) return Promise.reject(new TypeError("Failed to fetch"));
    if (body.password === "wrong-password") return response({ detail: { code: "invalid_credentials" } }, 401);
    return sessionBody(principalFor("administrator"));
  }
  if (path.endsWith("/auth/me")) {
    const role = new Headers(options.headers).get("X-GrantFlow-Development-Role") || "administrator";
    return response(principalFor(role, { tenantId: "development" }));
  }
  if (path.endsWith("/portal/grants")) {
    return response([{
      id: 1,
      displayName: "Pilot Line Automation",
      reference: "GRANT-001",
      clientName: "Acme Robotics",
      reports: [{ index: 0, reportType: "Progress Report", dueDate: "2021-01-30", periodStartDate: "2020-10-01", periodEndDate: "2020-12-31", status: null }],
      requests: [],
    }]);
  }
  if (path.endsWith("/grants")) return response([]);
  return response({});
}

const calls = (suffix) => fetch.mock.calls.filter(([url]) => String(url).endsWith(suffix));

describe("sign-in doors", () => {
  let container;
  let root;
  let assign;

  beforeEach(() => {
    server = { sso: false, ssoRequired: false, offline: false };
    localStorage.clear();
    sessionStorage.clear();
    DATA.grants.length = 0;
    session.STORE_STATE = "loading";
    Object.assign(state, { view: "home", grantId: null });
    vi.stubGlobal("fetch", vi.fn(mockFetch));
    assign = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mount(path = "/app/") {
    window.history.replaceState(null, "", path);
    vi.spyOn(browser, "go").mockImplementation(assign);
    await act(async () => {
      root = createRoot(container);
      root.render(<AuthGate />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function fill(label, value) {
    const node = [...container.querySelectorAll("label")]
      .find((candidate) => candidate.textContent.startsWith(label));
    const input = node.htmlFor ? container.querySelector(`#${node.htmlFor}`) : node.querySelector("input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function submit() {
    await act(async () => {
      container.querySelector("form.login-form").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function click(text) {
    const button = [...container.querySelectorAll("button")]
      .find((node) => node.textContent.includes(text) || node.getAttribute("aria-label")?.includes(text));
    expect(button, `button "${text}"`).toBeTruthy();
    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("defaults to email and password, with organisation sign-in boxed below", async () => {
    await mount("/app/");
    expect(container.querySelector("#login-title").textContent).toBe("Sign in");
    expect(container.textContent).toContain("Enter your email and password.");
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    // Other ways in sit in one compact row, not spelled out at length.
    const strip = container.querySelector(".login-provider-strip");
    expect([...strip.querySelectorAll("button")].map((button) => button.textContent))
      .toEqual(["Google", "Microsoft", "SSO"]);
    expect(container.querySelector('input[name="email"][autocomplete="username"]')).not.toBeNull();
    expect(container.querySelectorAll('input[type="email"]')).toHaveLength(1);
    expect(container.querySelectorAll(".login-story")).toHaveLength(3);
    expect(container.querySelector(".login-top .wordmark").textContent).toBe("GrantFlow");
    expect(container.querySelector("details.login-dev").open).toBe(false);
  });

  it("plays the stories on its own, with three quiet dots and no timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    await mount("/app/");
    const active = () => [...container.querySelectorAll(".login-story")].findIndex((node) => node.classList.contains("is-active"));
    expect(container.querySelectorAll(".login-story-dots button")).toHaveLength(3);
    expect(container.querySelector(".login-story-progress, .login-story-fill")).toBeNull();
    expect(container.textContent).not.toMatch(/Pause|Play|Next card|Previous card/);
    expect(container.querySelectorAll(".login-story-visual svg.story-art")).toHaveLength(3);
    expect(container.querySelectorAll(".login-stories img")).toHaveLength(0);
    act(() => vi.advanceTimersByTime(7000));
    expect(active()).toBe(1);
    await act(async () => container.querySelector('[aria-label="Show story 3 of 3"]').click());
    expect(active()).toBe(2);
    act(() => vi.advanceTimersByTime(7000));
    expect(active()).toBe(0);
    vi.useRealTimers();
  });

  it("holds still for people who prefer reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query) => ({
      matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {},
    }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    await mount("/app/");
    act(() => vi.advanceTimersByTime(21000));
    expect(container.querySelector(".login-story.is-active .login-story-heading").textContent)
      .toContain("tells your team what's next");
    vi.useRealTimers();
  });

  it("signs in with email and password", async () => {
    await mount("/app/");
    fill("Email", "owner@acme.test");
    fill("Password", "wrong-password");
    await submit();
    expect(container.textContent).toContain("don't match a GrantFlow account");
    fill("Password", "correct horse battery");
    await submit();
    expect(JSON.parse(calls("/auth/login")[1][1].body)).toEqual({ email: "owner@acme.test", password: "correct horse battery" });
    expect(container.textContent).toContain("Administrator · Acme Grants");
  });

  it("explains an invalid email without calling the server", async () => {
    await mount("/app/");
    fill("Email", "casey@acme");
    fill("Password", "anything");
    await submit();
    expect(container.querySelector("#email-error").textContent).toContain("Enter a valid email address");
    expect(calls("/auth/login")).toHaveLength(0);
  });

  it("offers a retry when the network fails", async () => {
    server.offline = true;
    await mount("/app/");
    fill("Email", "owner@acme.test");
    fill("Password", "correct horse battery");
    await submit();
    expect(container.textContent).toContain("couldn't reach");
    server.offline = false;
    await click("try again");
    expect(container.textContent).toContain("Administrator · Acme Grants");
  });

  it("resets a forgotten password by email", async () => {
    await mount("/app/");
    await click("Forgot password?");
    expect(container.querySelector("#login-title").textContent).toBe("Reset your password");
    fill("Email", "owner@acme.test");
    await submit();
    expect(JSON.parse(calls("/auth/password/forgot")[0][1].body)).toEqual({ email: "owner@acme.test" });
    expect(container.textContent).toContain("If there's an account for owner@acme.test");
    await click("Back to sign in");
    expect(container.querySelector("#login-title").textContent).toBe("Sign in");
  });

  it("chooses a password from a reset or invitation link", async () => {
    await mount("/app/?reset=good-token");
    expect(window.location.search).toBe("");
    expect(container.querySelector("#login-title").textContent).toBe("Choose a password");
    fill("New password", "a fresh password");
    fill("Confirm password", "a different one!");
    await submit();
    expect(container.textContent).toContain("Those passwords don't match.");
    fill("Confirm password", "a fresh password");
    await submit();
    expect(JSON.parse(calls("/auth/password/reset")[0][1].body)).toEqual({ token: "good-token", password: "a fresh password" });
    expect(container.textContent).toContain("Grant adviser · Acme Grants");
  });

  it("explains an expired reset link and offers a new one", async () => {
    await mount("/app/?reset=old-token");
    fill("New password", "a fresh password");
    fill("Confirm password", "a fresh password");
    await submit();
    expect(container.textContent).toContain("That link has expired or was already used.");
    await click("Send me a new link");
    expect(container.querySelector("#login-title").textContent).toBe("Reset your password");
  });

  it("has no emailed sign-in link on the main page", async () => {
    await mount("/app/");
    expect(container.textContent).not.toMatch(/sign-in link/i);
  });

  it("sends Google and Microsoft straight to the provider", async () => {
    await mount("/app/");
    await click("Continue with Microsoft");
    const target = new URL(assign.mock.calls[0][0]);
    expect(target.pathname).toBe("/auth/oidc/microsoft/start");
    expect(target.searchParams.get("audience")).toBe("firm");
  });

  it("finds an organisation's SSO from a work email", async () => {
    server.sso = true;
    await mount("/app/");
    await click("organisation's SSO");
    fill("Work email", "adviser@acme.test");
    await act(async () => {
      container.querySelector(".login-org-sso form").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const target = new URL(assign.mock.calls[0][0]);
    expect(target.pathname).toBe("/auth/oidc/sso/start");
    expect(target.searchParams.get("email")).toBe("adviser@acme.test");
  });

  it("explains when an organisation has no SSO", async () => {
    await mount("/app/");
    await click("organisation's SSO");
    fill("Work email", "someone@plainfirm.test");
    await act(async () => {
      container.querySelector(".login-org-sso form").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Single sign-on isn't set up for plainfirm.test");
    expect(assign).not.toHaveBeenCalled();
  });

  it("offers account creation, which always starts a new firm", async () => {
    await mount("/app/");
    await click("Create an account");
    expect(container.querySelector("#login-title").textContent).toBe("Create your firm's workspace");
    expect(container.textContent).toContain("You'll be its administrator.");
    expect(container.textContent).toContain("look for the invitation in your email");
    expect(container.querySelector('select, input[name="role"]')).toBeNull();
    await click("Sign in");
    expect(container.querySelector("#login-title").textContent).toBe("Sign in");
  });

  it("can create the firm with Google, carrying its name through", async () => {
    await mount("/app/?signup");
    fill("Firm name", "Acme Grants");
    fill("Your name", "Ada Owner");
    await submit();
    await click("Create with Google");
    const target = new URL(assign.mock.calls[0][0]);
    expect(target.pathname).toBe("/auth/oidc/google/start");
    expect(target.searchParams.get("intent")).toBe("signup");
    expect(target.searchParams.get("organizationName")).toBe("Acme Grants");
  });

  it("creates a firm in two short steps", async () => {
    await mount("/app/?signup");
    expect(container.textContent).toContain("Create your firm's workspace");
    expect(container.querySelector('input[type="password"]')).toBeNull();
    fill("Firm name", "Acme Grants");
    fill("Your name", "Ada Owner");
    await submit();
    expect(container.querySelector(".login-email-chip").textContent).toContain("Acme Grants");
    expect([...container.querySelectorAll(".login-provider-strip button")].map((b) => b.textContent))
      .toEqual(["Google", "Microsoft"]);
    fill("Work email", "ada@acme.test");
    fill("Password", "correct horse battery");
    await submit();
    expect(JSON.parse(calls("/auth/signup")[0][1].body).organizationName).toBe("Acme Grants");
    await act(async () => {
      container.querySelector('[aria-label="Sign out"]').click();
      await Promise.resolve();
    });
    expect(localStorage.getItem("grantflowSession")).toBeNull();
  });

  it("still signs invited clients in at the client portal", async () => {
    await mount("/app/client/");
    expect(container.textContent).toContain("Sign in to your grant portal");
    fill("Email", "client@clientco.test");
    await submit();
    expect(JSON.parse(calls("/auth/email-code")[0][1].body)).toEqual({ email: "client@clientco.test", audience: "client" });
    expect(container.textContent).toContain("Check your inbox");
    fill("Or enter the 6-digit code", "123456");
    await act(async () => {
      container.querySelector("form.login-code-form").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Pilot Line Automation");
  });

  it("finishes a Google sign-in from the redirect and tidies the address bar", async () => {
    await mount("/app/client/?login=one-time");
    expect(JSON.parse(calls("/auth/exchange")[0][1].body)).toEqual({ code: "one-time" });
    expect(window.location.search).toBe("");
    expect(container.textContent).toContain("Pilot Line Automation");
  });

  it("points people who came in the wrong door to the right one", async () => {
    await mount("/app/?login_error=wrong_portal");
    expect(container.textContent).toContain("That email is set up for the client portal.");
    const link = [...container.querySelectorAll(".login-error a")][0];
    expect(link.getAttribute("href")).toBe("/app/client/");
  });

  it("explains a firm's SSO requirement after a refused Google sign-in", async () => {
    await mount("/app/?login_error=sso_required&provider=Acme%20Okta");
    expect(container.textContent).toContain("Your firm signs in with Acme Okta.");
  });

  it("previews the client portal in development", async () => {
    localStorage.setItem("grantflowDevelopmentRole", "client_contributor");
    await mount("/app/client/");
    expect(container.textContent).toContain("Everything your grant adviser needs from you");
    expect(container.textContent).not.toContain("Maximum funds");
  });
});
