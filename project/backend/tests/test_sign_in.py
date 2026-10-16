"""Roles and sign-in flows against a real SQLite file and a fake OIDC provider.

The fake provider answers for Google, Microsoft and a firm's own IdP through
an in-memory HTTP transport, signing real RS256 ID tokens, so every check in
the OIDC client (signature, audience, issuer, nonce) runs for real.
"""

from __future__ import annotations

import json
import re
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import storage  # noqa: E402
from grantflow_api.application import create_app  # noqa: E402
from grantflow_api.config import Settings  # noqa: E402
from grantflow_api.services.mail import ConsoleEmailSender  # noqa: E402
from grantflow_api.services.oidc import OidcClient  # noqa: E402

APP_URL = "http://localhost:8000/app/"
FIRM_IDP = "https://idp.acme.test"
ISSUERS = {
    "accounts.google.com": "https://accounts.google.com",
    "idp.acme.test": FIRM_IDP,
}


def new_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeIdentityProvider:
    """Discovery, keys and token endpoints for every provider host."""

    def __init__(self):
        self.key = new_key()
        self.next_claims: dict = {}
        self.signing_key = self.key
        self.token_requests: list[httpx.Request] = []

    def jwks(self):
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
        return {"keys": [{**jwk, "kid": "k1", "use": "sig", "alg": "RS256"}]}

    def handle(self, request: httpx.Request) -> httpx.Response:
        host = request.url.host
        base = f"https://{host}"
        path = request.url.path
        if path.endswith("/.well-known/openid-configuration"):
            prefix = path.removesuffix("/.well-known/openid-configuration")
            issuer = ISSUERS.get(host, f"https://login.microsoftonline.com/{{tenantid}}/v2.0")
            return httpx.Response(200, json={
                "issuer": issuer,
                "authorization_endpoint": f"{base}{prefix}/authorize",
                "token_endpoint": f"{base}{prefix}/token",
                "jwks_uri": f"{base}{prefix}/jwks",
            })
        if path.endswith("/jwks"):
            return httpx.Response(200, json=self.jwks())
        if path.endswith("/token"):
            self.token_requests.append(request)
            now = int(time.time())
            claims = {"iat": now, "exp": now + 300, **self.next_claims}
            token = jwt.encode(claims, self.signing_key, algorithm="RS256", headers={"kid": "k1"})
            return httpx.Response(200, json={"id_token": token, "access_token": "x"})
        return httpx.Response(404)


class SignInTestCase(unittest.TestCase):
    settings_overrides: dict = {}

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original_path = storage.DB_PATH
        storage.DB_PATH = Path(self.directory.name) / "test.db"
        self.idp = FakeIdentityProvider()
        self.mail = ConsoleEmailSender()
        settings = Settings(
            title="Test API",
            version="test",
            cors_origins=(),
            frontend_directory=Path("/missing"),
            public_app_url=APP_URL,
            google_client_id="google-client",
            google_client_secret="google-secret",
            microsoft_client_id="microsoft-client",
            microsoft_client_secret="microsoft-secret",
            **self.settings_overrides,
        )
        oidc = OidcClient(
            httpx.Client(transport=httpx.MockTransport(self.idp.handle)),
            allow_private_hosts=True,
        )
        self.client = TestClient(create_app(settings, oidc=oidc, mail=self.mail))

    def tearDown(self):
        storage.DB_PATH = self.original_path
        self.directory.cleanup()

    # -- helpers ---------------------------------------------------------------

    def firm(self, name="Acme Advisory", email="owner@acme.test"):
        response = self.client.post("/auth/signup", json={
            "organizationName": name,
            "displayName": f"{name} owner",
            "email": email,
            "password": "correct horse battery",
        })
        self.assertEqual(response.status_code, 201, response.text)
        return {"Authorization": f"Bearer {response.json()['token']}"}

    def grant(self, headers, reference="ACME-1"):
        response = self.client.post("/grants", headers=headers, json={
            "displayName": reference,
            "client": {"displayName": "Client Pty Ltd"},
            "grant": {"projectReferenceNumber": reference},
            "milestones": [],
            "budgetCategories": [],
            "reportingObligations": [],
        })
        return response.json()["_dbId"]

    def invite(self, headers, email, role="client_contributor", grant_ids=(), expect=201):
        response = self.client.post("/admin/people", headers=headers, json={
            "email": email,
            "displayName": email.split("@")[0].title(),
            "role": role,
            "clientName": "Client Pty Ltd" if role == "client_contributor" else None,
            "grantIds": list(grant_ids),
        })
        self.assertEqual(response.status_code, expect, response.text)
        return response.json()

    def last_code(self):
        return re.search(r"enter this code: (\d{6})", self.mail.outbox[-1].body).group(1)

    def last_link(self):
        return re.search(r"(http\S+\?login=(\S+))", self.mail.outbox[-1].body).groups()

    def email_code_session(self, email, audience):
        self.client.post("/auth/email-code", json={"email": email, "audience": audience})
        return self.client.post("/auth/email-code/verify", json={
            "email": email, "audience": audience, "code": self.last_code(),
        })

    def oidc(self, provider, claims, *, audience="firm", cookie=True, **params):
        """Run start → provider → callback. Returns the final app URL's query."""
        start = self.client.get(
            f"/auth/oidc/{provider}/start",
            params={"audience": audience, **params},
            follow_redirects=False,
        )
        self.assertEqual(start.status_code, 303, start.text)
        location = urlsplit(start.headers["location"])
        query = parse_qs(location.query)
        if "login_error" in query:
            return {k: v[0] for k, v in query.items()}
        self.idp.next_claims = {"nonce": query["nonce"][0], **claims}
        if not cookie:
            self.client.cookies.clear()
        callback = self.client.get(
            "/auth/oidc/callback",
            params={"state": query["state"][0], "code": "provider-code"},
            follow_redirects=False,
        )
        self.assertEqual(callback.status_code, 303)
        target = urlsplit(callback.headers["location"])
        result = {k: v[0] for k, v in parse_qs(target.query).items()}
        result["path"] = target.path
        result["state"] = query["state"][0]
        return result

    def exchange(self, result):
        response = self.client.post("/auth/exchange", json={"code": result["login"]})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    @staticmethod
    def google(email, sub="g-1", verified=True, aud="google-client"):
        return {
            "iss": "https://accounts.google.com", "aud": aud, "sub": sub,
            "email": email, "email_verified": verified, "name": "Google Person",
        }

    @staticmethod
    def microsoft(email, edov=True, tid="tenant-1", oid="o-1"):
        claims = {
            "iss": f"https://login.microsoftonline.com/{tid}/v2.0", "aud": "microsoft-client",
            "sub": "pairwise", "tid": tid, "oid": oid, "email": email, "name": "MS Person",
        }
        if edov:
            claims["xms_edov"] = True
        return claims


class RoleTests(SignInTestCase):
    def test_grant_advisers_manage_clients_but_not_firm_staff(self):
        owner = self.firm()
        grant_id = self.grant(owner)
        self.invite(owner, "adviser@acme.test", role="grant_adviser")
        adviser = self.email_code_session("adviser@acme.test", "firm")
        self.assertEqual(adviser.json()["principal"]["role"], "grant_adviser")
        headers = {"Authorization": f"Bearer {adviser.json()['token']}"}

        self.assertEqual(self.client.get("/grants", headers=headers).status_code, 200)
        self.invite(headers, "client@clientco.test", grant_ids=[grant_id])
        self.invite(headers, "other@acme.test", role="grant_adviser", expect=403)
        self.assertEqual(self.client.get("/admin/sign-in", headers=headers).status_code, 403)

    def test_clients_only_reach_the_portal_and_their_grants(self):
        owner = self.firm()
        assigned = self.grant(owner, "ASSIGNED")
        self.grant(owner, "OTHER")
        self.invite(owner, "client@clientco.test", grant_ids=[assigned])
        session = self.email_code_session("client@clientco.test", "client")
        self.assertEqual(session.status_code, 200)
        headers = {"Authorization": f"Bearer {session.json()['token']}"}

        self.assertEqual(self.client.get("/grants", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/admin/users", headers=headers).status_code, 403)
        portal = self.client.get("/portal/grants", headers=headers).json()
        self.assertEqual([grant["reference"] for grant in portal], ["ASSIGNED"])

    def test_invitation_emails_point_to_the_right_door(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        self.assertIn(f"{APP_URL}client/", self.mail.outbox[-1].body)
        self.invite(owner, "adviser@acme.test", role="grant_adviser")
        self.assertIn(APP_URL, self.mail.outbox[-1].body)
        self.assertNotIn("client/", self.mail.outbox[-1].body)

    def test_the_last_administrator_stays(self):
        owner = self.firm()
        me = self.client.get("/admin/users", headers=owner).json()[0]
        demote = self.client.patch(
            f"/admin/users/{me['id']}", headers=owner, json={"role": "grant_adviser"},
        )
        self.assertEqual(demote.status_code, 409)

    def test_invited_people_are_told_to_accept_rather_than_start_a_firm(self):
        owner = self.firm()
        self.invite(owner, "adviser@acme.test", role="grant_adviser")
        response = self.client.post("/auth/signup", json={
            "organizationName": "Accidental Firm",
            "displayName": "Adviser",
            "email": "adviser@acme.test",
            "password": "correct horse battery",
        })
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["code"], "already_invited")

    def test_one_email_belongs_to_one_person(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        self.invite(owner, "CLIENT@clientco.test", expect=409)
        other = self.firm("Beta", "owner@beta.test")
        self.invite(other, "client@clientco.test", expect=409)


class EmailCodeTests(SignInTestCase):
    def test_wrong_door_is_refused_without_sending_a_code(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        sent = len(self.mail.outbox)
        response = self.client.post(
            "/auth/email-code", json={"email": "client@clientco.test", "audience": "firm"},
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(len(self.mail.outbox), sent)

    def test_unknown_email_looks_the_same_as_a_known_one(self):
        response = self.client.post(
            "/auth/email-code", json={"email": "nobody@nowhere.test", "audience": "client"},
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.mail.outbox, [])

    def test_codes_are_single_use_and_lock_after_repeated_guesses(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        self.client.post(
            "/auth/email-code", json={"email": "client@clientco.test", "audience": "client"},
        )
        code = self.last_code()
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(5):
            self.client.post("/auth/email-code/verify", json={
                "email": "client@clientco.test", "audience": "client", "code": wrong,
            })
        locked = self.client.post("/auth/email-code/verify", json={
            "email": "client@clientco.test", "audience": "client", "code": code,
        })
        self.assertEqual(locked.status_code, 401)

        ok = self.email_code_session("client@clientco.test", "client")
        self.assertEqual(ok.status_code, 200)
        reused = self.client.post("/auth/email-code/verify", json={
            "email": "client@clientco.test", "audience": "client", "code": self.last_code(),
        })
        self.assertEqual(reused.status_code, 401)

    def test_codes_are_not_stored_in_plain_text(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        self.client.post(
            "/auth/email-code", json={"email": "client@clientco.test", "audience": "client"},
        )
        with storage._connect() as conn:
            stored = conn.execute("SELECT code_hash FROM email_codes").fetchone()["code_hash"]
        self.assertNotIn(self.last_code(), stored)


class SingleEmailFieldTests(SignInTestCase):
    """One email field for everyone: SSO firms redirect, everyone else gets a link."""

    def test_discovery_routes_by_domain_only(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        for email in ("client@clientco.test", "nobody@nowhere.test", "owner@acme.test"):
            found = self.client.post("/auth/discover", json={"email": email}).json()
            self.assertEqual(found["route"], "magic_link", email)

    def test_the_link_signs_each_person_into_their_own_door(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        self.invite(owner, "adviser@acme.test", role="grant_adviser")

        self.client.post("/auth/email-code", json={"email": "client@clientco.test"})
        url, token = self.last_link()
        self.assertTrue(url.startswith(f"{APP_URL}client/?login="))
        client = self.client.post("/auth/exchange", json={"code": token}).json()
        self.assertEqual(client["principal"]["role"], "client_contributor")

        self.client.post("/auth/email-code", json={"email": "adviser@acme.test"})
        url, token = self.last_link()
        self.assertTrue(url.startswith(f"{APP_URL}?login="))
        adviser = self.client.post("/auth/exchange", json={"code": token}).json()
        self.assertEqual(adviser["principal"]["role"], "grant_adviser")

        reused = self.client.post("/auth/exchange", json={"code": token})
        self.assertEqual(reused.status_code, 400)

    def test_the_code_works_without_naming_a_door(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        self.client.post("/auth/email-code", json={"email": "client@clientco.test"})
        response = self.client.post("/auth/email-code/verify", json={
            "email": "client@clientco.test", "code": self.last_code(),
        })
        self.assertEqual(response.json()["principal"]["role"], "client_contributor")

    def test_unknown_emails_get_the_same_answer_and_no_email(self):
        response = self.client.post("/auth/email-code", json={"email": "nobody@nowhere.test"})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.mail.outbox, [])


class PasswordResetTests(SignInTestCase):
    def reset_token(self):
        return re.search(r"\?reset=(\S+)", self.mail.outbox[-1].body).group(1)

    def test_forgot_password_resets_and_signs_in(self):
        self.firm()
        response = self.client.post("/auth/password/forgot", json={"email": "owner@acme.test"})
        self.assertEqual(response.status_code, 202)
        token = self.reset_token()
        reset = self.client.post("/auth/password/reset", json={"token": token, "password": "brand new password"})
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(reset.json()["principal"]["role"], "administrator")
        login = self.client.post("/auth/login", json={"email": "owner@acme.test", "password": "brand new password"})
        self.assertEqual(login.status_code, 200)
        again = self.client.post("/auth/password/reset", json={"token": token, "password": "another password!"})
        self.assertEqual(again.json()["detail"]["code"], "reset_link_expired")

    def test_reset_links_are_not_login_tokens(self):
        self.firm()
        self.client.post("/auth/password/forgot", json={"email": "owner@acme.test"})
        response = self.client.post("/auth/exchange", json={"code": self.reset_token()})
        self.assertEqual(response.status_code, 400)

    def test_unknown_emails_and_clients_get_no_reset_email(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        sent = len(self.mail.outbox)
        for email in ("nobody@nowhere.test", "client@clientco.test"):
            response = self.client.post("/auth/password/forgot", json={"email": email})
            self.assertEqual(response.status_code, 202)
        self.assertEqual(len(self.mail.outbox), sent)

    def test_weak_new_passwords_are_refused(self):
        self.firm()
        self.client.post("/auth/password/forgot", json={"email": "owner@acme.test"})
        response = self.client.post("/auth/password/reset", json={"token": self.reset_token(), "password": "short"})
        self.assertEqual(response.json()["detail"]["code"], "weak_password")

    def test_invited_staff_choose_a_password_from_the_invitation(self):
        owner = self.firm()
        self.invite(owner, "adviser@acme.test", role="grant_adviser")
        self.assertIn("choose a password", self.mail.outbox[-1].body)
        response = self.client.post("/auth/password/reset", json={
            "token": self.reset_token(), "password": "adviser password 1",
        })
        self.assertEqual(response.json()["principal"]["role"], "grant_adviser")
        login = self.client.post("/auth/login", json={"email": "adviser@acme.test", "password": "adviser password 1"})
        self.assertEqual(login.status_code, 200)


class OidcTests(SignInTestCase):
    def test_google_links_an_invited_client_by_verified_email(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        result = self.oidc("google", self.google("client@clientco.test"), audience="client")
        self.assertEqual(result["path"], "/app/client/")
        session = self.exchange(result)
        self.assertEqual(session["principal"]["role"], "client_contributor")

        # The identity is now linked: a later sign-in works even if the
        # provider stops sending the email.
        again = self.oidc("google", {**self.google(""), "email_verified": False}, audience="client")
        self.assertIn("login", again)

    def test_unverified_or_unknown_emails_are_refused(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        unverified = self.oidc(
            "google", self.google("client@clientco.test", verified=False), audience="client",
        )
        self.assertEqual(unverified["login_error"], "email_not_verified")
        unknown = self.oidc("google", self.google("stranger@else.test", sub="g-2"))
        self.assertEqual(unknown["login_error"], "no_account")

    def test_each_role_uses_its_own_door(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        result = self.oidc("google", self.google("client@clientco.test"), audience="firm")
        self.assertEqual(result["login_error"], "wrong_portal")

    def test_sign_up_a_firm_with_google(self):
        result = self.oidc(
            "google",
            self.google("founder@newfirm.test", sub="g-9"),
            intent="signup",
            organizationName="New Firm",
            displayName="Founder",
        )
        session = self.exchange(result)
        self.assertEqual(session["principal"]["organizationName"], "New Firm")
        self.assertEqual(session["principal"]["role"], "administrator")
        self.assertEqual(session["principal"]["displayName"], "Founder")

    def test_microsoft_email_is_trusted_only_when_the_domain_is_verified(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        spoofable = self.oidc(
            "microsoft", self.microsoft("client@clientco.test", edov=False), audience="client",
        )
        self.assertEqual(spoofable["login_error"], "email_not_verified")
        verified = self.oidc(
            "microsoft", self.microsoft("client@clientco.test", oid="o-2"), audience="client",
        )
        self.assertIn("login", verified)

    def test_microsoft_issuer_must_match_the_tenant(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        claims = {**self.microsoft("client@clientco.test"), "iss": "https://evil.test/v2.0"}
        result = self.oidc("microsoft", claims, audience="client")
        self.assertEqual(result["login_error"], "invalid_id_token")

    def test_forged_or_misdirected_tokens_are_refused(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        self.idp.signing_key = new_key()
        forged = self.oidc("google", self.google("client@clientco.test"), audience="client")
        self.assertEqual(forged["login_error"], "invalid_id_token")

        self.idp.signing_key = self.idp.key
        other_app = self.oidc(
            "google", self.google("client@clientco.test", aud="someone-else"), audience="client",
        )
        self.assertEqual(other_app["login_error"], "invalid_id_token")

        replay = self.oidc(
            "google", {**self.google("client@clientco.test"), "nonce": "stale"}, audience="client",
        )
        self.assertEqual(replay["login_error"], "invalid_id_token")

    def test_a_flow_must_finish_in_the_browser_that_started_it(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        result = self.oidc(
            "google", self.google("client@clientco.test"), audience="client", cookie=False,
        )
        self.assertEqual(result["login_error"], "sign_in_expired")

    def test_login_codes_and_states_are_single_use(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        result = self.oidc("google", self.google("client@clientco.test"), audience="client")
        self.exchange(result)
        again = self.client.post("/auth/exchange", json={"code": result["login"]})
        self.assertEqual(again.status_code, 400)
        replayed = self.client.get(
            "/auth/oidc/callback",
            params={"state": result["state"], "code": "provider-code"},
            follow_redirects=False,
        )
        self.assertIn("login_error=sign_in_expired", replayed.headers["location"])

    def test_cancelling_at_the_provider_returns_to_the_same_door(self):
        start = self.client.get(
            "/auth/oidc/google/start", params={"audience": "client"}, follow_redirects=False,
        )
        state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
        back = self.client.get(
            "/auth/oidc/callback",
            params={"state": state, "error": "access_denied"},
            follow_redirects=False,
        )
        self.assertEqual(
            back.headers["location"], f"{APP_URL}client/?login_error=sign_in_cancelled",
        )


class SingleTenantMicrosoftTests(SignInTestCase):
    """The workspace's own Entra app: only its tenant, admins by app role."""

    settings_overrides = {
        "microsoft_tenant": "tenant-1",
        "entra_tenant_id": "tenant-1",
        "entra_admin_role": "Noah.Administrator",
    }

    def claims(self, email, *, tid="tenant-1", oid="o-1", roles=(), with_email=True):
        claims = {
            "iss": f"https://login.microsoftonline.com/{tid}/v2.0", "aud": "microsoft-client",
            "sub": "pairwise", "tid": tid, "oid": oid, "name": "Tenant Person",
            "preferred_username": email,
        }
        if with_email:
            claims["email"] = email
        if roles:
            claims["roles"] = list(roles)
        return claims

    def test_discovery_uses_the_tenant_endpoint(self):
        self.oidc("microsoft", self.claims("x@tenant.test"))
        token_url = str(self.idp.token_requests[-1].url)
        self.assertIn("login.microsoftonline.com/tenant-1/", token_url)

    def test_admin_app_role_signs_into_the_primary_workspace(self):
        result = self.oidc("microsoft", self.claims("boss@tenant.test", roles=["Noah.Administrator"]))
        principal = self.exchange(result)["principal"]
        self.assertEqual(principal["role"], "administrator")
        self.assertEqual(principal["organizationId"], 1)
        self.assertTrue(principal["microsoftIntegrations"])

    def test_tenant_members_without_the_role_need_an_invitation(self):
        result = self.oidc("microsoft", self.claims("someone@tenant.test", oid="o-2"))
        self.assertEqual(result["login_error"], "no_account")

    def test_own_directory_is_trusted_for_email_even_without_xms_edov(self):
        owner = self.firm()
        self.invite(owner, "adviser@tenant.test", role="grant_adviser")
        result = self.oidc("microsoft", self.claims("adviser@tenant.test", oid="o-3", with_email=False))
        self.assertEqual(self.exchange(result)["principal"]["role"], "grant_adviser")

    def test_other_tenants_are_refused(self):
        result = self.oidc(
            "microsoft", self.claims("boss@elsewhere.test", tid="tenant-2", roles=["Noah.Administrator"]),
        )
        self.assertEqual(result["login_error"], "invalid_id_token")


class FirmSsoTests(SignInTestCase):
    def connect_sso(self, owner, *, enforced=False, auto_join=True):
        self.client.post("/admin/sign-in/domains", headers=owner, json={"domain": "acme.test"})
        verified = self.client.post(
            "/admin/sign-in/domains/acme.test/verify?skipDns=true", headers=owner,
        )
        self.assertEqual(verified.status_code, 200, verified.text)
        response = self.client.put("/admin/sign-in/sso", headers=owner, json={
            "displayName": "Acme Okta",
            "issuer": FIRM_IDP,
            "clientId": "acme-client",
            "clientSecret": "acme-secret",
            "enforced": enforced,
            "autoJoin": auto_join,
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def firm_claims(self, email, sub="okta-1"):
        return {"iss": FIRM_IDP, "aud": "acme-client", "sub": sub, "email": email, "name": "Okta Person"}

    def test_email_first_discovery_routes_staff_to_their_firms_provider(self):
        owner = self.firm()
        self.connect_sso(owner)
        found = self.client.post("/auth/discover", json={"email": "new@acme.test"}).json()
        self.assertEqual(found["route"], "sso")
        self.assertEqual(found["sso"]["label"], "Acme Okta")
        other = self.client.post("/auth/discover", json={"email": "x@other.test"}).json()
        self.assertIsNone(other["sso"])

    def test_auto_join_adds_new_staff_as_grant_advisers(self):
        owner = self.firm()
        self.connect_sso(owner)
        result = self.oidc("sso", self.firm_claims("new@acme.test"), email="new@acme.test")
        session = self.exchange(result)
        self.assertEqual(session["principal"]["role"], "grant_adviser")
        self.assertEqual(session["principal"]["organizationName"], "Acme Advisory")

    def test_the_firm_provider_cannot_vouch_for_other_domains(self):
        owner = self.firm()
        self.invite(owner, "client@clientco.test")
        self.connect_sso(owner)
        result = self.oidc(
            "sso", self.firm_claims("client@clientco.test", sub="okta-9"),
            audience="client", email="someone@acme.test",
        )
        self.assertEqual(result["login_error"], "email_not_verified")

    def test_required_sso_blocks_every_other_method_for_staff(self):
        owner = self.firm()
        self.connect_sso(owner, enforced=True)
        sent = len(self.mail.outbox)
        self.client.post("/auth/password/forgot", json={"email": "owner@acme.test"})
        self.assertEqual(len(self.mail.outbox), sent)
        password = self.client.post(
            "/auth/login", json={"email": "owner@acme.test", "password": "correct horse battery"},
        )
        self.assertEqual(password.status_code, 403)
        self.assertEqual(password.json()["detail"]["code"], "sso_required")

        google = self.oidc("google", self.google("owner@acme.test"))
        self.assertEqual(google["login_error"], "sso_required")

        sso = self.oidc("sso", self.firm_claims("owner@acme.test", sub="okta-owner"), email="owner@acme.test")
        self.assertEqual(self.exchange(sso)["principal"]["role"], "administrator")

    def test_sso_client_secret_is_encrypted_and_never_returned(self):
        owner = self.firm()
        connection = self.connect_sso(owner)
        self.assertNotIn("clientSecret", connection)
        with storage._connect() as conn:
            stored = conn.execute("SELECT client_secret FROM sso_connections").fetchone()[0]
        self.assertNotIn("acme-secret", stored)
        token_request = None
        self.oidc("sso", self.firm_claims("new@acme.test"), email="new@acme.test")
        token_request = self.idp.token_requests[-1]
        self.assertIn("Basic", token_request.headers["authorization"])

    def test_domains_are_exclusive_and_shared_providers_unclaimable(self):
        owner = self.firm()
        self.connect_sso(owner)
        rival = self.firm("Rival", "owner@rival.test")
        self.client.post("/admin/sign-in/domains", headers=rival, json={"domain": "acme.test"})
        claimed = self.client.post(
            "/admin/sign-in/domains/acme.test/verify?skipDns=true", headers=rival,
        )
        self.assertEqual(claimed.status_code, 409)
        gmail = self.client.post("/admin/sign-in/domains", headers=rival, json={"domain": "gmail.com"})
        self.assertEqual(gmail.status_code, 422)

    def test_enforcing_sso_needs_a_verified_domain(self):
        owner = self.firm()
        response = self.client.put("/admin/sign-in/sso", headers=owner, json={
            "displayName": "Acme Okta", "issuer": FIRM_IDP, "clientId": "c",
            "clientSecret": "s", "enforced": True, "autoJoin": False,
        })
        self.assertEqual(response.json()["detail"]["code"], "verified_domain_required")


if __name__ == "__main__":
    unittest.main()
