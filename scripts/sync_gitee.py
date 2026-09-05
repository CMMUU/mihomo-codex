#!/usr/bin/env python3
"""One-way repository/release synchronization. No GitHub writes; no asset replacement."""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener
import uuid

REPOS = {"routedeck"}
GH_OWNER, GE_OWNER = "CMMUU", "cmmuu"
GH_API, GE_API = "https://api.github.com", "https://gitee.com/api/v5"
MAX_JSON, MAX_ASSET = 8 * 1024 * 1024, 512 * 1024 * 1024
# Conservative decimal interpretation of the community plan's 100 MB / 1 GB.
GE_MAX_ASSET, GE_MAX_TOTAL = 100_000_000, 1_000_000_000
READ_ATTEMPTS = 3
TRANSIENT_HTTP = {408, 429, 500, 502, 503, 504}
GH_STORAGE = {"release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com"}
GE_STORAGE = {"foruda.gitee.com"}


class SyncError(Exception):
    pass


class RetryableReadError(SyncError):
    pass


def configured_bytes(name, default, maximum):
    value = os.environ.get(name, "") or str(default)
    if not re.fullmatch(r"[0-9]+", value) or not 0 <= int(value) <= maximum:
        raise SyncError(f"{name} must be a nonnegative byte count within the supported limit")
    return int(value)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def safe_name(value):
    if (not isinstance(value, str) or not value or value in {".", ".."}
            or value.endswith((" ", ".")) or any(ord(c) < 32 or c in '/\\:<>"|?*' for c in value)):
        raise SyncError("Unsafe attachment filename")
    return value


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def source_digest(asset):
    value = asset.get("digest")
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"sha256:[0-9a-fA-F]{64}", value):
        raise SyncError("Unsupported GitHub asset digest")
    return value[7:].lower()


def release_metadata_matches(actual, expected, keys):
    for key in keys:
        left, right = actual.get(key), expected[key]
        if key == "body" and isinstance(left, str) and isinstance(right, str):
            # Gitee's web editor returns CRLF; retain Markdown whitespace and
            # the original source body when writing the API.
            left, right = left.replace("\r\n", "\n"), right.replace("\r\n", "\n")
        if left != right:
            return False
    return True


def validate_pair(repo, source, target):
    if repo not in REPOS:
        raise SyncError("Repository is outside the permitted migration scope")
    for info, owner in ((source, GH_OWNER), (target, GE_OWNER)):
        if (str(info.get("owner", {}).get("login", "")).casefold() != owner.casefold()
                or type(info.get("private")) is not bool):
            raise SyncError("Repository owner, name or visibility could not be confirmed")
    if str(source.get("full_name", "")).casefold() != f"{GH_OWNER}/{repo}".casefold():
        raise SyncError("GitHub source repository does not match the requested scope")
    target_url = f"https://gitee.com/{GE_OWNER}/{repo}".casefold()
    if (str(target.get("path", "")).casefold() != repo.casefold()
            or str(target.get("html_url", "")).casefold() not in {target_url, target_url + ".git"}):
        raise SyncError("Gitee target path does not match the requested scope")
    if source["private"] and not target["private"]:
        raise SyncError("Private GitHub source must never synchronize to a public Gitee target")


def checked_url(url, allowed_hosts):
    parsed = urlsplit(url)
    try:
        port = parsed.port
    except ValueError:
        raise SyncError("Invalid download port") from None
    if (parsed.scheme != "https" or parsed.hostname not in allowed_hosts or port not in (None, 443)
            or parsed.username or parsed.password or parsed.fragment):
        raise SyncError("Untrusted download redirect; no credentials were forwarded")
    return parsed


class Api:
    def __init__(self, service, token, storage_hosts=()):
        self.service, self.token = service, token
        self.base = GH_API if service == "github" else GE_API
        self.host = "api.github.com" if service == "github" else "gitee.com"
        self.storage_hosts = GH_STORAGE if service == "github" else GE_STORAGE | set(storage_hosts)
        self.opener = build_opener(NoRedirect())

    def headers(self):
        headers = {"Authorization": "Bearer " + self.token, "User-Agent": "CMMUU-Gitee-Sync/1", "Accept": "application/json"}
        if self.service == "github":
            headers["X-GitHub-Api-Version"] = "2022-11-28"
        return headers

    def request(self, path, method="GET", data=None):
        for attempt in range(READ_ATTEMPTS):
            try:
                return self._request_once(path, method, data)
            except RetryableReadError:
                if attempt == READ_ATTEMPTS - 1:
                    raise
                time.sleep(2 ** attempt)

    def _request_once(self, path, method="GET", data=None):
        if self.service == "github" and method != "GET":
            raise SyncError("GitHub writes are not supported")
        if not path.startswith("/") or "access_token=" in path or "token=" in path:
            raise SyncError("Invalid API path")
        headers, body = self.headers(), None
        if data is not None:
            # Gitee documents access_token in formData for writes; keep it in
            # the in-memory body, never a URL, file, command argument or log.
            fields = {**data, "access_token": self.token}
            body = urlencode(fields).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        req = Request(self.base + path, data=body, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=45) as response:
                raw = response.read(MAX_JSON + 1)
                if len(raw) > MAX_JSON:
                    raise SyncError("API response exceeds the metadata limit")
                return json.loads(raw)
        except HTTPError as error:
            # Never print response bodies, full URLs or signed query strings.
            if method == "GET" and error.code in TRANSIENT_HTTP:
                raise RetryableReadError(f"{self.service} API temporarily unavailable (HTTP {error.code})") from None
            raise SyncError(f"{self.service} API returned HTTP {error.code}; no write was retried") from None
        except (URLError, TimeoutError, OSError, ValueError, http.client.HTTPException):
            error_type = RetryableReadError if method == "GET" else SyncError
            raise error_type(f"{self.service} API request failed; details suppressed to protect credentials") from None

    def pages(self, path):
        rows = []
        for page in range(1, 1001):
            data = self.request(path + ("&" if "?" in path else "?") + urlencode({"page": page, "per_page": 100}))
            if not isinstance(data, list):
                raise SyncError("Unexpected paginated API response")
            rows.extend(data)
            if len(data) < 100:
                return rows
        raise SyncError("Pagination limit exceeded")

    def download(self, path, destination, expected_size, expected_sha=None):
        for attempt in range(READ_ATTEMPTS):
            try:
                return self._download_once(path, destination, expected_size, expected_sha)
            except RetryableReadError:
                if attempt == READ_ATTEMPTS - 1:
                    raise
                time.sleep(2 ** attempt)

    def _download_once(self, path, destination, expected_size, expected_sha=None):
        if type(expected_size) is not int or not 0 <= expected_size <= MAX_ASSET:
            raise SyncError("Attachment size is outside the supported limit")
        destination = Path(destination)
        cached_sha = None
        if destination.exists():
            if destination.is_symlink() or not destination.is_file() or destination.stat().st_size != expected_size:
                raise SyncError("Existing local attachment has a different size or type")
            actual = sha256(destination)
            if expected_sha is not None and actual == expected_sha:
                return actual
            if expected_sha is not None:
                raise SyncError("Existing local attachment has a different SHA-256; it was not overwritten")
            # Older GitHub assets have no digest. Fetch their bytes again and
            # compare to the cache; a local hash alone is not source evidence.
            cached_sha = actual
        url, headers = self.base + path, self.headers()
        headers["Accept"] = "application/octet-stream"
        allowed = {self.host} | self.storage_hosts
        part = destination.with_name(destination.name + ".part-" + uuid.uuid4().hex)
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            for redirect in range(6):
                checked_url(url, allowed)
                try:
                    response = self.opener.open(Request(url, headers=headers), timeout=90)
                    break
                except HTTPError as error:
                    if error.code in TRANSIENT_HTTP:
                        raise RetryableReadError(f"{self.service} attachment temporarily unavailable (HTTP {error.code})") from None
                    if error.code not in (301, 302, 303, 307, 308) or redirect == 5:
                        raise SyncError(f"{self.service} attachment returned HTTP {error.code}") from None
                    location = error.headers.get("Location", "")
                    if not location or self.token in location:
                        raise SyncError("Missing redirect or a redirect containing an authentication credential")
                    location = urljoin(url, location)
                    checked_url(location, allowed)
                    # A signed download URL is used only in memory. Strip auth
                    # even on same-host redirects; never follow credentialed URLs.
                    headers = {"Accept": "application/octet-stream", "User-Agent": "CMMUU-Gitee-Sync/1"}
                    url = location
            size, hasher = 0, hashlib.sha256()
            with response, part.open("xb") as stream:
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    size += len(block)
                    if size > expected_size:
                        raise SyncError("Attachment is larger than source metadata")
                    hasher.update(block)
                    stream.write(block)
            actual = hasher.hexdigest()
            if size != expected_size or (expected_sha is not None and actual != expected_sha):
                raise SyncError("Attachment size or SHA-256 validation failed")
            if cached_sha is not None:
                if actual != cached_sha:
                    raise SyncError("Cached unhashed attachment differs from the current source; neither file was overwritten")
            else:
                part.rename(destination)
            return actual
        except (URLError, TimeoutError, OSError, ValueError, http.client.HTTPException):
            raise RetryableReadError(f"{self.service} attachment transfer failed; safe to rerun") from None
        finally:
            if part.exists():
                part.unlink()

    def upload(self, path, file):
        if self.service != "gitee" or "?" in path:
            raise SyncError("Uploads are restricted to the Gitee API")
        file = Path(file)
        name = safe_name(file.name)
        boundary = "gitee-sync-" + uuid.uuid4().hex
        start = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"access_token\"\r\n\r\n".encode()
                 + self.token.encode() + f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n".encode())
        end = f"\r\n--{boundary}--\r\n".encode()
        conn = http.client.HTTPSConnection("gitee.com", timeout=180)
        try:
            conn.putrequest("POST", "/api/v5" + path)
            conn.putheader("Content-Type", "multipart/form-data; boundary=" + boundary)
            conn.putheader("Content-Length", str(len(start) + file.stat().st_size + len(end)))
            conn.putheader("User-Agent", "CMMUU-Gitee-Sync/1")
            conn.endheaders()
            conn.send(start)
            with file.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    conn.send(block)
            conn.send(end)
            response = conn.getresponse()
            raw = response.read(MAX_JSON + 1)
            if response.status != 201 or len(raw) > MAX_JSON:
                raise SyncError(f"Gitee upload returned HTTP {response.status}; do not blindly retry POST")
            return json.loads(raw)
        except (OSError, ValueError, http.client.HTTPException):
            raise SyncError("Gitee upload outcome is uncertain; rerun to inspect existing attachments") from None
        finally:
            conn.close()


def verify_manifest(files):
    manifests = [item for item in files if item["name"] == "SHA256SUMS.txt"]
    if not manifests:
        return
    path = Path(manifests[0]["path"])
    if path.stat().st_size > 65536:
        raise SyncError("SHA256SUMS.txt exceeds the expected size")
    rows = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line:
            continue
        match = re.fullmatch(r"([0-9a-fA-F]{64}) [ *](.+)", line)
        if not match or match[2] in rows:
            raise SyncError("Malformed or ambiguous SHA256SUMS.txt")
        rows[safe_name(match[2])] = match[1].lower()
    expected = {item["name"]: item["sha256"] for item in files if item not in manifests}
    if rows != expected:
        raise SyncError("SHA256SUMS.txt does not exactly match the release attachments")


def git_credential():
    """Invoked ONLY by Git; stdout is the credential pipe, never a normal log."""
    fields = dict(line.rstrip("\n").split("=", 1) for line in sys.stdin if "=" in line)
    repo = os.environ.get("SYNC_REPO", "")
    host, path = fields.get("host"), fields.get("path", "").removesuffix(".git")
    owner = GH_OWNER if host == "github.com" else GE_OWNER
    if repo not in REPOS or fields.get("protocol") != "https" or host not in {"github.com", "gitee.com"} or path.casefold() != f"{owner}/{repo}".casefold():
        return
    token = os.environ.get("GITHUB_TOKEN" if host == "github.com" else "GITEE_TOKEN", "")
    if token and sys.argv[-1] == "get":
        username = "x-access-token" if host == "github.com" else GE_OWNER
        sys.stdout.write(f"username={username}\npassword={token}\n\n")


def git_failure_kind(stderr):
    # Classify locally; never log Git stderr, which may contain credentials.
    message = stderr.lower()
    if any(value in message for value in ("authentication failed", "could not read username", "error: 401", "error: 403")):
        return "authorization"
    if "atomic" in message and "support" in message:
        return "unsupported atomic push"
    if any(value in message for value in ("non-fast-forward", "fetch first", "already exists")):
        return "conflicting refs or existing destination"
    if any(value in message for value in ("connection reset", "connection timed out", "timed out", "tls", "ssl", "http/2", "could not resolve", "failed to connect", "remote end hung up", "error: 500", "error: 502", "error: 503", "error: 504")):
        return "transient network"
    return "unclassified transport failure"


def git_run(repo, *args):
    env = os.environ.copy()
    env.update({"SYNC_REPO": repo, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "Never",
                "GIT_TRACE": "0", "GIT_TRACE_CURL": "0", "GIT_CURL_VERBOSE": "0",
                "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
                "GIT_ALLOW_PROTOCOL": "https"})
    helper = "!" + shlex.quote(Path(sys.executable).as_posix()) + " " + shlex.quote(Path(__file__).resolve().as_posix()) + " _git_credential"
    command = ["git", "-c", "http.version=HTTP/1.1", "-c", "credential.helper=", "-c", "credential.helper=" + helper,
               "-c", "credential.useHttpPath=true", "-c", "core.askPass=", *args]
    operation_args = args[2:] if args[:1] == ("--git-dir",) else args
    operation = operation_args[0] if operation_args else "unknown"
    if operation not in {"clone", "fetch", "push", "ls-remote", "rev-parse", "remote", "for-each-ref"}:
        operation = "other"
    attempts = READ_ATTEMPTS if operation in {"fetch", "ls-remote"} else 1
    for attempt in range(attempts):
        try:
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=300)
        except (OSError, subprocess.TimeoutExpired):
            kind = "transient network"
        else:
            if not result.returncode:
                return result.stdout.strip()
            kind = git_failure_kind(result.stderr or "")
        if kind != "transient network" or attempt == attempts - 1:
            raise SyncError(f"Git {operation} failed ({kind}); no credential output is logged and remote refs were not forced") from None
        time.sleep(2 ** attempt)


class Sync:
    def __init__(self, repo, github, gitee, work, max_asset_bytes=GE_MAX_ASSET,
                 max_total_bytes=GE_MAX_TOTAL, other_attachment_bytes=0):
        self.repo, self.gh, self.ge, self.work = repo, github, gitee, Path(work)
        if repo not in REPOS:
            raise SyncError("Unsupported repository")
        self.source_path = f"/repos/{GH_OWNER}/{repo}"
        self.target_path = f"/repos/{GE_OWNER}/{repo}"
        self.source = None
        self.max_asset_bytes, self.max_total_bytes = max_asset_bytes, max_total_bytes
        self.other_attachment_bytes = other_attachment_bytes
        self.release_assets = {}

    def guard(self):
        self.source = self.gh.request(self.source_path)
        target = self.ge.request(self.target_path)
        validate_pair(self.repo, self.source, target)
        # Public repository metadata can succeed without valid credentials.
        # /user must authenticate the intended owner before any external write.
        identity = self.ge.request("/user")
        if str(identity.get("login", "")).casefold() != GE_OWNER.casefold():
            raise SyncError("Gitee credential identity must match the permitted target owner")
        return target

    def sync_refs(self):
        self.guard()
        self.work.mkdir(parents=True, exist_ok=True)
        bare = self.work / (self.repo + ".git")
        source_url = f"https://github.com/{GH_OWNER}/{self.repo}.git"
        if bare.exists():
            if (bare.is_symlink() or git_run(self.repo, "--git-dir", str(bare), "rev-parse", "--is-bare-repository") != "true"
                    or git_run(self.repo, "--git-dir", str(bare), "remote", "get-url", "origin") != source_url):
                raise SyncError("Existing working mirror does not match the source repository")
            git_run(self.repo, "--git-dir", str(bare), "fetch", "--prune", "origin")
        else:
            git_run(self.repo, "clone", "--mirror", source_url, str(bare))
        self.guard()  # Recheck privacy immediately before the first external write.
        destination = f"https://gitee.com/{GE_OWNER}/{self.repo}.git"
        # Explicit namespaces: no deletion, force push, pull refs or remote configs.
        push_error = None
        try:
            git_run(self.repo, "--git-dir", str(bare), "push", "--atomic", destination,
                    "refs/heads/*:refs/heads/*", "refs/tags/*:refs/tags/*")
        except SyncError as error:
            # A lost response can follow a successful push. Do not retry the
            # write: independently read every expected ref before accepting it.
            push_error = error
        expected = dict(line.split(" ", 1) for line in git_run(self.repo, "--git-dir", str(bare), "for-each-ref",
                        "--format=%(refname) %(objectname)", "refs/heads", "refs/tags").splitlines())
        actual = {ref: sha for sha, ref in (line.split() for line in git_run(self.repo, "ls-remote", "--refs", destination).splitlines())}
        if any(actual.get(ref) != sha for ref, sha in expected.items()):
            if push_error is not None:
                raise push_error
            raise SyncError("Gitee branches or tags did not match the source after push")
        return bare

    def source_assets(self, release):
        release_id = release.get("id")
        if type(release_id) is not int:
            raise SyncError("Source release ID is missing or invalid")
        if release_id in self.release_assets:
            return self.release_assets[release_id]
        assets = self.gh.pages(f"{self.source_path}/releases/{release_id}/assets")
        names = set()
        for asset in assets:
            name = safe_name(asset.get("name"))
            if name.casefold() in names or asset.get("state") != "uploaded" or type(asset.get("id")) is not int:
                raise SyncError("Incomplete or ambiguous GitHub attachment")
            names.add(name.casefold())
            size = asset.get("size")
            if type(size) is not int or not 0 <= size <= min(self.max_asset_bytes, MAX_ASSET):
                raise SyncError(f"GitHub attachment exceeds the configured Gitee per-file limit ({self.max_asset_bytes} bytes)")
            if asset.get("url") != GH_API + f"{self.source_path}/releases/assets/{asset['id']}":
                raise SyncError("GitHub attachment belongs to a different repository")
            source_digest(asset)
        self.release_assets[release_id] = assets
        return assets

    def plan_release_capacity(self, releases):
        # Include every existing Gitee release, including target-only releases.
        # Regular repository attachments are not listed by the release API;
        # reserve their known usage via GITEE_OTHER_ATTACHMENT_BYTES.
        existing, total = {}, self.other_attachment_bytes
        for release in self.ge.pages(self.target_path + "/releases"):
            release_id, tag = release.get("id"), release.get("tag_name")
            if type(release_id) is not int or not isinstance(tag, str) or not tag or tag in existing:
                raise SyncError("Ambiguous destination release metadata")
            by_name = {}
            for asset in self.ge.pages(f"{self.target_path}/releases/{release_id}/attach_files"):
                name, size = safe_name(asset.get("name")), asset.get("size")
                if name.casefold() in by_name or type(size) is not int or size < 0:
                    raise SyncError("Ambiguous destination attachment size or name")
                by_name[name.casefold()] = (name, size)
                total += size
            existing[tag] = by_name
        added, seen = 0, set()
        for release in releases:
            if release.get("draft"):
                continue
            tag = release.get("tag_name")
            if not isinstance(tag, str) or not tag or tag in seen:
                raise SyncError("Ambiguous source release tags")
            seen.add(tag)
            for asset in self.source_assets(release):
                present = existing.get(tag, {}).get(asset["name"].casefold())
                if present is not None:
                    if present != (asset["name"], asset["size"]):
                        raise SyncError("Existing Gitee attachment conflicts with the source; no files were replaced")
                else:
                    added += asset["size"]
        if total + added > self.max_total_bytes:
            raise SyncError(f"Gitee attachment capacity exceeded: projected {total + added} bytes, limit {self.max_total_bytes}; no release writes started")
        print(f"Attachment capacity checked: {total} existing/reserved + {added} new bytes (limit {self.max_total_bytes})", flush=True)

    def ensure_attachment(self, release_id, item):
        endpoint = f"{self.target_path}/releases/{release_id}/attach_files"
        matches = [asset for asset in self.ge.pages(endpoint) if asset.get("name") == item["name"]]
        if len(matches) > 1:
            raise SyncError("Duplicate destination attachment names; no files were replaced")
        if not matches:
            self.guard()
            if Path(item["path"]).stat().st_size != item["size"] or sha256(item["path"]) != item["sha256"]:
                raise SyncError("Local source attachment changed before upload")
            self.ge.upload(endpoint, item["path"])
            matches = [asset for asset in self.ge.pages(endpoint) if asset.get("name") == item["name"]]
            if len(matches) != 1:
                raise SyncError("Upload completed without one unambiguous destination attachment")
        asset = matches[0]
        if type(asset.get("id")) is not int or (type(asset.get("size")) is int and asset["size"] != item["size"]):
            raise SyncError("Destination attachment metadata differs; it was not replaced")
        # Gitee AttachFile has no documented digest. Compare downloaded bytes,
        # including existing same-name attachments, instead of trusting the name.
        check = self.work / "verify" / str(release_id) / (str(asset["id"]) + ".verify-" + uuid.uuid4().hex)
        try:
            self.ge.download(f"{endpoint}/{asset['id']}/download", check, item["size"], item["sha256"])
        finally:
            if check.exists():
                check.unlink()

    def sync_release(self, release, bare):
        if release.get("draft"):
            return  # Gitee release API has no documented equivalent of GitHub drafts.
        tag = release.get("tag_name", "")
        if not isinstance(tag, str) or not tag or "\x00" in tag:
            raise SyncError("Invalid release tag")
        commit = git_run(self.repo, "--git-dir", str(bare), "rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}")
        if not re.fullmatch(r"[0-9a-f]{40,64}", commit):
            raise SyncError("Release tag does not resolve to a source commit")
        assets = self.source_assets(release)
        files = []
        directory = self.work / "assets" / self.repo / str(release["id"])
        for asset in assets:
            name = asset["name"]
            api_path = f"{self.source_path}/releases/assets/{asset['id']}"
            file = directory / name
            actual = self.gh.download(api_path, file, asset["size"], source_digest(asset))
            files.append({"name": name, "path": file, "size": asset["size"], "sha256": actual})
        verify_manifest(files)
        matches = [row for row in self.ge.pages(self.target_path + "/releases") if row.get("tag_name") == tag]
        if len(matches) > 1:
            raise SyncError("Duplicate destination releases for one tag")
        metadata = {"tag_name": tag, "name": release.get("name") or tag, "body": release.get("body") or "",
                    "prerelease": bool(release.get("prerelease")), "target_commitish": commit}
        self.guard()
        if not matches:
            target = self.ge.request(self.target_path + "/releases", "POST", {**metadata, "prerelease": str(metadata["prerelease"]).lower()})
        else:
            target = matches[0]
            if not release_metadata_matches(target, metadata, ("name", "body", "prerelease")):
                target = self.ge.request(f"{self.target_path}/releases/{target['id']}", "PATCH",
                                         {key: str(value).lower() if type(value) is bool else value for key, value in metadata.items() if key != "target_commitish"})
        if type(target.get("id")) is not int or target.get("tag_name") != tag:
            raise SyncError("Gitee release response does not match the source tag")
        # Gitee has no draft assets. Make updater manifests visible only after
        # every installer and signature has been uploaded and hash-verified.
        for item in sorted(files, key=lambda item: (item["name"] in {"latest.json", "latest-gitee.json"}, item["name"])):
            self.ensure_attachment(target["id"], item)
        confirmed = self.ge.request(f"{self.target_path}/releases/{target['id']}")
        if not release_metadata_matches(confirmed, metadata, ("tag_name", "name", "body", "prerelease")):
            raise SyncError("Gitee release metadata did not match after synchronization")
        print(f"Synchronized {self.repo}: {tag}, {len(files)} attachment(s)", flush=True)

    def run(self, scope, apply):
        self.guard()
        # Code updates remain useful even when the separate attachment quota
        # is exhausted. Privacy/ref checks still run before any Git push.
        bare = self.sync_refs() if apply else None
        if apply:
            print(f"Synchronized and verified {self.repo} branches and tags", flush=True)
        releases = self.gh.pages(self.source_path + "/releases") if scope == "all" else []
        if scope == "all":
            self.plan_release_capacity(releases)
        if not apply:
            print(f"Preflight passed for {self.repo}; {len(releases)} release(s) found. No external changes without --apply.")
            return
        for release in reversed(releases):
            self.sync_release(release, bare)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", choices=sorted(REPOS), required=True)
    parser.add_argument("--scope", choices=("refs", "all"), default="all")
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--apply", action="store_true", help="Explicitly authorize writes to the checked Gitee repository")
    args = parser.parse_args()
    gh_token, ge_token = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITEE_TOKEN")
    if not gh_token or not ge_token:
        raise SyncError("Set GITHUB_TOKEN and GITEE_TOKEN in the environment; never pass tokens as arguments")
    extra_hosts = {value.strip().lower() for value in os.environ.get("GITEE_ASSET_HOSTS", "").split(",") if value.strip()}
    if any(not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*", host) for host in extra_hosts):
        raise SyncError("GITEE_ASSET_HOSTS accepts exact hostnames only, without wildcards or URLs")
    max_asset = configured_bytes("GITEE_MAX_ASSET_BYTES", GE_MAX_ASSET, MAX_ASSET)
    max_total = configured_bytes("GITEE_MAX_TOTAL_BYTES", GE_MAX_TOTAL, 100_000_000_000)
    reserved = configured_bytes("GITEE_OTHER_ATTACHMENT_BYTES", 0, max_total)
    Sync(args.repo, Api("github", gh_token), Api("gitee", ge_token, extra_hosts), args.work_dir,
         max_asset, max_total, reserved).run(args.scope, args.apply)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "_git_credential":
        git_credential()
    else:
        try:
            main()
        except SyncError as error:
            print(f"Sync stopped: {error}", file=sys.stderr)
            raise SystemExit(1)
