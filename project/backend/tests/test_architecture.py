from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
import zipfile
from io import BytesIO
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from extractors import PROGRAMS  # noqa: E402
from grantflow_api.application import create_app  # noqa: E402
from grantflow_api.auth.models import Identity  # noqa: E402
from grantflow_api.config import Settings  # noqa: E402
from grantflow_api.domain import InvalidGrantBundle, validate_grant_bundle  # noqa: E402
from grantflow_api.services.documents import (  # noqa: E402
    MAX_UPLOAD_BYTES,
    InvalidUpload,
    _validate_office_archive,
    extract_uploaded_document,
)
from fastapi.testclient import TestClient  # noqa: E402
from starlette.datastructures import UploadFile  # noqa: E402


class MemoryGrantRepository:
    def __init__(self):
        self.initialized = False

    def initialize(self):
        self.initialized = True

    def list(self, organization_id=1):
        if organization_id != 1:
            return []
        grant = {
            "_dbId": 7,
            "_rev": 0,
            "displayName": "Test grant",
            "client": {"displayName": "Recipient Pty Ltd"},
            "grant": {"projectReferenceNumber": "TEST7"},
            "milestones": [],
            "budgetCategories": [],
            "reportingObligations": [{
                "reportType": "Progress Report",
                "dueDate": "2026-08-30",
                "periodStartDate": "2026-01-01",
                "periodEndDate": "2026-06-30",
            }],
            "evidenceRequirements": [{
                "id": "ev1",
                "milestoneNumber": 1,
                "outcome": "Commissioning evidence",
                "required": True,
                "satisfied": True,
                "documents": [{"name": "private.pdf", "url": "https://private"}],
            }],
        }
        return [
            grant,
            {
                **grant,
                "_dbId": 8,
                "displayName": "Unassigned grant",
                "grant": {"projectReferenceNumber": "TEST8"},
            },
        ]

    def create(self, grant, organization_id):
        return {**grant, "_dbId": 1, "_rev": 0}

    def get(self, grant_id, organization_id):
        return next(
            (grant for grant in self.list(organization_id) if grant["_dbId"] == grant_id),
            None,
        )

    def update(self, grant_id, grant, expected_revision, organization_id):
        return 1

    def delete(self, grant_id, organization_id):
        return True


class MemoryAccessRepository:
    def __init__(self, users=None):
        self.initialized = False
        self.users = users or []

    def initialize(self):
        self.initialized = True

    def list_users(self, organization_id):
        return [
            user for user in self.users
            if user.get("organizationId", 1) == organization_id
        ]

    def find_user(self, tenant_id, object_id):
        return next(
            (
                user for user in self.users
                if user["tenantId"] == tenant_id and user["objectId"] == object_id
            ),
            None,
        )

    def save_user(self, user):
        return user

    def delete_user(self, user_id, organization_id):
        return True

    def get_organization(self, organization_id):
        return {"id": organization_id, "name": "Primary firm"}

    def create_account(self, organization_name, user, email, password_hash):
        raise NotImplementedError

    def find_password_credential(self, email):
        return None

    def development_session_secret(self):
        return "test-secret-" + "x" * 40

    def development_secret(self, name, generate):
        return generate()


class FixedRecipientAuthenticator:
    def authenticate(self, request, token):
        return Identity(
            tenant_id="tenant-1",
            object_id="recipient-1",
            email="recipient@example.com",
            display_name="Recipient One",
        )


class ArchitectureTests(unittest.TestCase):
    def test_program_registry_is_self_describing(self):
        self.assertTrue(PROGRAMS["ac"].implemented)
        self.assertTrue(PROGRAMS["bff"].implemented)
        self.assertFalse(PROGRAMS["arena"].implemented)
        self.assertTrue(callable(PROGRAMS["ac"].extract))

    def test_normalized_grant_contract(self):
        bundle = {
            "client": {},
            "grant": {"projectReferenceNumber": "AC1"},
            "milestones": [],
            "budgetCategories": [],
            "reportingObligations": [],
        }
        validate_grant_bundle(bundle)
        with self.assertRaises(InvalidGrantBundle):
            validate_grant_bundle({"grant": {}})

    def test_grant_contract_rejects_unsafe_evidence_links(self):
        bundle = {
            "client": {},
            "grant": {"projectReferenceNumber": "AC1"},
            "milestones": [],
            "budgetCategories": [],
            "reportingObligations": [],
            "evidenceRequirements": [{
                "documents": [{
                    "name": "unsafe.html",
                    "url": "javascript:alert(document.domain)",
                }],
            }],
        }
        with self.assertRaises(InvalidGrantBundle):
            validate_grant_bundle(bundle)

        bundle["evidenceRequirements"][0]["documents"][0]["url"] = (
            "https://contoso.sharepoint.com/evidence/file.pdf"
        )
        validate_grant_bundle(bundle)

    def test_document_upload_limits_and_archive_bomb_protection(self):
        oversized = UploadFile(
            filename="large.pdf",
            file=BytesIO(b"x" * (MAX_UPLOAD_BYTES + 1)),
        )
        with self.assertRaises(InvalidUpload):
            asyncio.run(
                extract_uploaded_document(
                    oversized,
                    (".pdf",),
                    lambda path: {"path": path},
                    "PDF",
                )
            )

        compressed = BytesIO()
        with zipfile.ZipFile(
            compressed,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
        ) as archive:
            archive.writestr("word/document.xml", "0" * (2 * 1024 * 1024))
        with self.assertRaises(InvalidUpload):
            _validate_office_archive(compressed.getvalue())

    def test_application_exposes_documented_api_with_replaceable_storage(self):
        repository = MemoryGrantRepository()
        access = MemoryAccessRepository()
        with tempfile.TemporaryDirectory() as directory:
            settings = Settings(
                title="Test API",
                version="test",
                cors_origins=(),
                frontend_directory=Path(directory) / "missing",
            )
            app = create_app(settings, repository, access)

        self.assertTrue(repository.initialized)
        self.assertTrue(access.initialized)
        schema = app.openapi()
        self.assertEqual(schema["info"]["title"], "Test API")
        self.assertIn("/extract", schema["paths"])
        self.assertIn("/grants", schema["paths"])
        self.assertIn("/sharepoint/list", schema["paths"])
        self.assertIn("/auth/me", schema["paths"])
        self.assertIn("/portal/grants", schema["paths"])

    def test_recipient_cannot_enter_internal_workspace(self):
        settings = Settings(
            title="Test API",
            version="test",
            cors_origins=(),
            frontend_directory=Path("/missing"),
        )
        app = create_app(
            settings,
            MemoryGrantRepository(),
            MemoryAccessRepository(),
        )
        client = TestClient(app)
        headers = {"X-GrantFlow-Development-Role": "client_contributor"}

        self.assertEqual(client.get("/grants", headers=headers).status_code, 403)
        portal = client.get("/portal/grants", headers=headers)
        self.assertEqual(portal.status_code, 200)
        payload = portal.json()[0]
        self.assertEqual(payload["reference"], "TEST7")
        self.assertNotIn("budgetCategories", payload)
        self.assertNotIn("allocations", payload)
        request = payload["requests"][0]
        self.assertEqual(request["documentCount"], 1)
        self.assertNotIn("documents", request)

    def test_development_authentication_cannot_run_in_production(self):
        settings = Settings(
            title="Test API",
            version="test",
            cors_origins=(),
            frontend_directory=Path("/missing"),
            environment="production",
            auth_mode="development",
        )
        with self.assertRaises(RuntimeError):
            create_app(
                settings,
                MemoryGrantRepository(),
                MemoryAccessRepository(),
            )

    def test_real_recipient_membership_limits_the_grant_projection(self):
        settings = Settings(
            title="Test API",
            version="test",
            cors_origins=(),
            frontend_directory=Path("/missing"),
        )
        access = MemoryAccessRepository([{
            "tenantId": "tenant-1",
            "objectId": "recipient-1",
            "email": "recipient@example.com",
            "displayName": "Recipient One",
            "role": "client_contributor",
            "clientName": "Recipient Pty Ltd",
            "grantIds": [7],
        }])
        app = create_app(
            settings,
            MemoryGrantRepository(),
            access,
            authenticator=FixedRecipientAuthenticator(),
        )
        client = TestClient(app)

        payload = client.get(
            "/portal/grants",
            headers={"Authorization": "Bearer test"},
        ).json()
        self.assertEqual([grant["id"] for grant in payload], [7])


class PasswordAccountTests(unittest.TestCase):
    """End-to-end sign-up and firm isolation against a real SQLite file."""

    def setUp(self):
        import storage

        self.storage = storage
        self.directory = tempfile.TemporaryDirectory()
        self.original_path = storage.DB_PATH
        storage.DB_PATH = Path(self.directory.name) / "test.db"
        settings = Settings(
            title="Test API",
            version="test",
            cors_origins=(),
            frontend_directory=Path("/missing"),
        )
        self.client = TestClient(create_app(settings))

    def tearDown(self):
        self.storage.DB_PATH = self.original_path
        self.directory.cleanup()

    def sign_up(self, firm, email, password="correct horse battery"):
        return self.client.post("/auth/signup", json={
            "organizationName": firm,
            "displayName": f"{firm} admin",
            "email": email,
            "password": password,
        })

    def bearer(self, response):
        return {"Authorization": f"Bearer {response.json()['token']}"}

    def grant(self, reference):
        return {
            "displayName": reference,
            "client": {},
            "grant": {"projectReferenceNumber": reference},
            "milestones": [],
            "budgetCategories": [],
            "reportingObligations": [],
        }

    def test_sign_up_creates_an_administrator_of_a_new_firm(self):
        response = self.sign_up("Acme Grants", "Owner@Acme.test")
        self.assertEqual(response.status_code, 201)
        principal = response.json()["principal"]
        self.assertEqual(principal["role"], "administrator")
        self.assertEqual(principal["organizationName"], "Acme Grants")
        self.assertEqual(principal["email"], "owner@acme.test")
        self.assertNotEqual(principal["organizationId"], 1)
        self.assertFalse(principal["microsoftIntegrations"])

        me = self.client.get("/auth/me", headers=self.bearer(response))
        self.assertEqual(me.json()["organizationName"], "Acme Grants")

    def test_passwords_are_hashed_and_checked(self):
        self.sign_up("Acme Grants", "owner@acme.test")
        stored = self.storage.find_password_credential("owner@acme.test")
        self.assertTrue(stored["passwordHash"].startswith("scrypt$"))
        self.assertNotIn("correct horse", stored["passwordHash"])

        wrong = self.client.post("/auth/login", json={
            "email": "owner@acme.test", "password": "not the password",
        })
        self.assertEqual(wrong.status_code, 401)
        unknown = self.client.post("/auth/login", json={
            "email": "nobody@acme.test", "password": "whatever-password",
        })
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong.json(), unknown.json())

        right = self.client.post("/auth/login", json={
            "email": "OWNER@acme.test", "password": "correct horse battery",
        })
        self.assertEqual(right.status_code, 200)
        self.assertEqual(right.json()["principal"]["organizationName"], "Acme Grants")

    def test_duplicate_email_and_weak_password_are_rejected(self):
        self.assertEqual(self.sign_up("Acme", "owner@acme.test").status_code, 201)
        self.assertEqual(self.sign_up("Other", "OWNER@acme.test").status_code, 409)
        self.assertEqual(
            self.sign_up("Weak", "weak@acme.test", password="short").status_code,
            422,
        )

    def test_repeated_failures_are_throttled(self):
        self.sign_up("Acme", "owner@acme.test")
        for _ in range(8):
            self.client.post("/auth/login", json={
                "email": "owner@acme.test", "password": "wrong-password",
            })
        blocked = self.client.post("/auth/login", json={
            "email": "owner@acme.test", "password": "correct horse battery",
        })
        self.assertEqual(blocked.status_code, 429)

    def test_firms_cannot_see_or_change_each_others_grants(self):
        acme = self.bearer(self.sign_up("Acme", "owner@acme.test"))
        beta = self.bearer(self.sign_up("Beta", "owner@beta.test"))

        created = self.client.post("/grants", json=self.grant("ACME-1"), headers=acme)
        self.assertEqual(created.status_code, 201)
        grant_id = created.json()["_dbId"]

        self.assertEqual(len(self.client.get("/grants", headers=acme).json()), 1)
        self.assertEqual(self.client.get("/grants", headers=beta).json(), [])
        # The local development workspace doesn't see firm grants either.
        self.assertEqual(self.client.get("/grants").json(), [])

        update = self.client.put(
            f"/grants/{grant_id}",
            json={**self.grant("HIJACKED"), "_rev": 0},
            headers=beta,
        )
        self.assertEqual(update.status_code, 404)
        self.assertEqual(
            self.client.delete(f"/grants/{grant_id}", headers=beta).status_code,
            404,
        )
        self.assertEqual(
            self.client.get("/grants", headers=acme).json()[0]["displayName"],
            "ACME-1",
        )

    def test_self_service_firms_cannot_use_the_servers_sharepoint(self):
        acme = self.bearer(self.sign_up("Acme", "owner@acme.test"))
        self.assertEqual(
            self.client.get("/sharepoint/status", headers=acme).status_code,
            403,
        )

    def test_administrator_cannot_remove_their_own_access(self):
        acme = self.bearer(self.sign_up("Acme", "owner@acme.test"))
        users = self.client.get("/admin/users", headers=acme).json()
        self.assertEqual([user["email"] for user in users], ["owner@acme.test"])
        response = self.client.delete(f"/admin/users/{users[0]['id']}", headers=acme)
        self.assertEqual(response.status_code, 409)

    def test_tampered_or_expired_session_is_rejected(self):
        response = self.sign_up("Acme", "owner@acme.test")
        token = response.json()["token"]
        forged = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
        self.assertEqual(
            self.client.get(
                "/grants", headers={"Authorization": f"Bearer {forged}"}
            ).status_code,
            401,
        )

    def test_existing_data_migrates_into_the_primary_workspace(self):
        primary = self.client.post("/grants", json=self.grant("LEGACY-1"))
        self.assertEqual(primary.status_code, 201)
        self.assertEqual(
            self.storage.get_organization(1)["name"],
            self.storage.PRIMARY_ORGANIZATION_NAME,
        )
        self.assertEqual(len(self.client.get("/grants").json()), 1)

    def test_signup_can_be_disabled(self):
        settings = Settings(
            title="Test API",
            version="test",
            cors_origins=(),
            frontend_directory=Path("/missing"),
            signup_enabled=False,
        )
        client = TestClient(create_app(settings))
        self.assertFalse(client.get("/auth/config").json()["signupEnabled"])
        response = client.post("/auth/signup", json={
            "organizationName": "Acme",
            "displayName": "Owner",
            "email": "owner@acme.test",
            "password": "correct horse battery",
        })
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
