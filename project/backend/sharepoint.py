"""
Microsoft Graph integration: browse the grant-evidence SharePoint site.

The workspace owns one SharePoint evidence site. Each grant is a folder under
the configured root, and each milestone's evidence lives in a subfolder.

Auth is app-only OAuth client credentials. In production, the application is
granted write access only to the approved evidence site through
`Sites.Selected`. End users never receive Graph credentials or raw site-wide
permissions.

Configuration comes from the environment so the client secret never touches the
database or the repo:

    SP_TENANT_ID      the directory (tenant) id of the evidence tenant
    SP_CLIENT_ID      the app registration's application (client) id
    SP_CLIENT_SECRET  a client secret for that app
    SP_SITE_ID        the SharePoint site id that holds the evidence
    SP_ROOT_FOLDER    root folder for grant folders (default "Grant Evidence")

stdlib only (urllib) — no new dependencies.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import storage

GRAPH = "https://graph.microsoft.com/v1.0"

_lock = threading.Lock()
_token = {"value": None, "expires": 0.0}   # cached app-only access token


class NotConnected(Exception):
    """Raised when the SharePoint app credentials are not configured."""


class GraphError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _config() -> dict:
    return {
        "tenant": os.environ.get("SP_TENANT_ID") or os.environ.get("ENTRA_TENANT_ID"),
        "client_id": os.environ.get("SP_CLIENT_ID") or os.environ.get("ENTRA_CLIENT_ID"),
        "client_secret": (
            os.environ.get("SP_CLIENT_SECRET")
            or os.environ.get("ENTRA_CLIENT_SECRET")
        ),
        "site_id": os.environ.get("SP_SITE_ID") or storage.get_setting("sp_site_id"),
        "root_folder": (
            os.environ.get("SP_ROOT_FOLDER")
            or storage.get_setting("sp_root_folder", "Grant Evidence")
        ),
    }


def credentials_configured() -> bool:
    cfg = _config()
    return all(cfg[k] for k in ("tenant", "client_id", "client_secret"))


def configured() -> bool:
    cfg = _config()
    return credentials_configured() and bool(cfg["site_id"])


# ---------------------------------------------------------------------------
# App-only token (client-credentials)
# ---------------------------------------------------------------------------

def _app_token() -> str:
    with _lock:
        if _token["value"] and time.time() < _token["expires"] - 60:
            return _token["value"]
    cfg = _config()
    if not credentials_configured():
        raise NotConnected()
    body = urllib.parse.urlencode({
        "client_id": cfg["client_id"],
        "client_secret": cfg["client_secret"],
        "grant_type": "client_credentials",
        "scope": "https://graph.microsoft.com/.default",
    }).encode()
    url = f"https://login.microsoftonline.com/{cfg['tenant']}/oauth2/v2.0/token"
    req = urllib.request.Request(url, data=body, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read()).get("error_description", "")
        except Exception:
            detail = f"HTTP {exc.code}"
        raise GraphError(exc.code, detail.split("\r\n")[0] or "Could not obtain an app token.")
    with _lock:
        _token["value"] = data["access_token"]
        _token["expires"] = time.time() + int(data.get("expires_in", 3600))
    return data["access_token"]


def _graph_get(path: str) -> dict:
    token = _app_token()
    req = urllib.request.Request(GRAPH + path, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read()).get("error", {}).get("message", "")
        except Exception:
            detail = ""
        raise GraphError(exc.code, detail or f"Microsoft Graph returned HTTP {exc.code}")


def _graph_write(path: str, body: bytes, content_type: str, method: str) -> dict:
    token = _app_token()
    req = urllib.request.Request(
        GRAPH + path,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": content_type,
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read()).get("error", {}).get("message", "")
        except Exception:
            detail = ""
        raise GraphError(exc.code, detail or f"Microsoft Graph returned HTTP {exc.code}")


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------

_ITEM_FIELDS = "$select=id,name,size,folder,file,webUrl,lastModifiedDateTime,parentReference"
_DOWNLOAD_FIELD = "@microsoft.graph.downloadUrl"


def _norm(item: dict) -> dict:
    return {
        "id": item["id"],
        "name": item.get("name"),
        "folder": "folder" in item,
        "childCount": (item.get("folder") or {}).get("childCount"),
        "size": item.get("size"),
        "modified": item.get("lastModifiedDateTime"),
        "webUrl": item.get("webUrl"),
        # Short-lived, pre-authenticated URL so a user can open a file without
        # the app minting one per click. Present on files, absent on folders.
        "downloadUrl": item.get(_DOWNLOAD_FIELD),
    }


def _site_drive_root(rel_path: str) -> str:
    """Path addressing for a folder under the site's default drive.

    rel_path is relative to the drive root, e.g.
    "Grant Evidence/Example Recipient - GRANT-001". An empty path is the root.
    """
    site = _config()["site_id"]
    if not rel_path:
        return f"/sites/{site}/drive/root"
    return f"/sites/{site}/drive/root:/{urllib.parse.quote(rel_path)}:"


def list_folder(rel_path: str = "") -> dict:
    """List a folder under the evidence site, addressed by path.

    Passing "" lists the root folder (where each grant folder lives). Returns
    the folder itself plus its immediate children. The children are fetched
    without $select so Graph includes the pre-authenticated
    @microsoft.graph.downloadUrl on each file.
    """
    base = _site_drive_root(rel_path)
    folder = _graph_get(f"{base}?{_ITEM_FIELDS}")
    children = _graph_get(f"{base}/children?$top=200")
    return {"folder": _norm(folder), "items": [_norm(x) for x in children.get("value", [])]}


def list_children(item_id: str) -> dict:
    """List a folder's children by drive-item id (used to drill into subfolders)."""
    site = _config()["site_id"]
    children = _graph_get(f"/sites/{site}/drive/items/{item_id}/children?$top=200")
    return {"items": [_norm(x) for x in children.get("value", [])]}


def list_grants() -> dict:
    """List the grant folders sitting directly under the root evidence folder."""
    return list_folder(_config()["root_folder"])


def _safe_segment(value: str) -> str:
    cleaned = "".join(
        "-" if char in '\\/:*?"<>|' else char
        for char in (value or "").strip()
    )
    return cleaned[:120] or "Unassigned"


def ensure_folder(rel_path: str) -> dict:
    """Create a folder path one segment at a time and return its final item."""

    parent_path = ""
    current = None
    for raw_segment in rel_path.split("/"):
        segment = _safe_segment(raw_segment)
        current_path = f"{parent_path}/{segment}".strip("/")
        try:
            current = _graph_get(f"{_site_drive_root(current_path)}?{_ITEM_FIELDS}")
        except GraphError as exc:
            if exc.status != 404:
                raise
            parent = _graph_get(f"{_site_drive_root(parent_path)}?{_ITEM_FIELDS}")
            site = _config()["site_id"]
            current = _graph_write(
                f"/sites/{site}/drive/items/{parent['id']}/children",
                json.dumps(
                    {
                        "name": segment,
                        "folder": {},
                        "@microsoft.graph.conflictBehavior": "fail",
                    }
                ).encode(),
                "application/json",
                "POST",
            )
        parent_path = current_path
    return _norm(current)


def grant_folder_path(client_name: str, reference: str) -> str:
    return "/".join(
        (
            _config()["root_folder"],
            _safe_segment(client_name),
            _safe_segment(reference),
        )
    )


def provision_grant(
    client_name: str,
    reference: str,
    reports: list[dict],
) -> dict:
    base = grant_folder_path(client_name, reference)
    created = [
        ensure_folder(base),
        ensure_folder(f"{base}/General agreement evidence"),
        ensure_folder(f"{base}/Reporting periods"),
    ]
    for index, report in enumerate(reports):
        label = (
            f"{report.get('dueDate') or index + 1} - "
            f"{report.get('reportType') or 'Report'}"
        )
        created.append(
            ensure_folder(f"{base}/Reporting periods/{label}/Client uploads")
        )
    return {"path": base, "folders": created}


def configure_site(site_url: str, root_folder: str) -> dict:
    parsed = urllib.parse.urlparse(site_url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Enter a full HTTPS SharePoint site URL.")
    path = parsed.path.rstrip("/")
    site = _graph_get(
        f"/sites/{urllib.parse.quote(parsed.hostname)}:{urllib.parse.quote(path)}"
        "?$select=id,displayName,webUrl"
    )
    storage.set_setting("sp_site_id", site["id"])
    storage.set_setting("sp_root_folder", _safe_segment(root_folder))
    ensure_folder(_safe_segment(root_folder))
    return {
        "connected": True,
        "site": site.get("displayName"),
        "webUrl": site.get("webUrl"),
        "rootFolder": _safe_segment(root_folder),
    }


def upload_report_file(
    client_name: str,
    reference: str,
    report: dict,
    report_index: int,
    filename: str,
    content: bytes,
) -> dict:
    base = grant_folder_path(client_name, reference)
    label = (
        f"{report.get('dueDate') or report_index + 1} - "
        f"{report.get('reportType') or 'Report'}"
    )
    folder_path = f"{base}/Reporting periods/{label}/Client uploads"
    ensure_folder(folder_path)
    site = _config()["site_id"]
    file_path = urllib.parse.quote(
        f"{folder_path}/{_safe_segment(filename)}",
        safe="/",
    )
    item = _graph_write(
        f"/sites/{site}/drive/root:/{file_path}:/content",
        content,
        "application/octet-stream",
        "PUT",
    )
    return _norm(item)


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

def status() -> dict:
    """Report whether app-only SharePoint access is configured and working."""
    if not credentials_configured():
        return {
            "connected": False,
            "mode": "app-only",
            "reason": "credentials_not_configured",
            "credentialsConfigured": False,
            "siteConfigured": False,
        }
    if not _config()["site_id"]:
        return {
            "connected": False,
            "mode": "app-only",
            "reason": "site_not_selected",
            "credentialsConfigured": True,
            "siteConfigured": False,
        }
    cfg = _config()
    try:
        site = _graph_get(f"/sites/{cfg['site_id']}?$select=displayName,webUrl")
        return {
            "connected": True,
            "mode": "app-only",
            "site": site.get("displayName"),
            "webUrl": site.get("webUrl"),
            "rootFolder": cfg["root_folder"],
            "credentialsConfigured": True,
            "siteConfigured": True,
        }
    except (GraphError, NotConnected) as exc:
        return {"connected": False, "mode": "app-only",
                "reason": getattr(exc, "message", "unreachable")}
