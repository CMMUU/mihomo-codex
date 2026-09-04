"""Offline boundaries only: no tokens, accounts, Git transport, or remote writes."""
import hashlib
import http.client
import json
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import sync_gitee as sync


HERE = Path(__file__).resolve().parent


def metadata(private=False, owner="cmmuu", repo="mihomo-codex"):
    return {"full_name": f"{owner}/{repo}", "owner": {"login": owner}, "private": private,
            "path": repo, "html_url": f"https://gitee.com/{owner}/{repo}"}


class Response(BytesIO):
    pass


class Opener:
    def __init__(self, results):
        self.results, self.requests = list(results), []

    def open(self, request, timeout):
        self.requests.append(request)
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class GiteeFixture:
    def __init__(self, content=None, copies=1):
        self.content, self.copies = content, copies
        self.uploads = 0

    def pages(self, path):
        if self.content is None:
            return []
        return [{"id": index + 1, "name": "package.zip", "size": len(self.content)} for index in range(self.copies)]

    def upload(self, path, file):
        self.uploads += 1
        self.content = Path(file).read_bytes()

    def download(self, path, destination, expected_size, expected_sha):
        if len(self.content) != expected_size or hashlib.sha256(self.content).hexdigest() != expected_sha:
            raise sync.SyncError("Attachment size or SHA-256 validation failed")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(self.content)
        return expected_sha


class SyncTests(unittest.TestCase):
    def fixture(self):
        temp = tempfile.TemporaryDirectory(prefix="offline-sync-", dir=HERE)
        self.addCleanup(temp.cleanup)
        return Path(temp.name)

    def test_private_to_public_is_blocked_before_git_or_release_writes(self):
        class GH:
            def request(self, path):
                return metadata(True, "CMMUU")
        class GE:
            def request(self, path):
                return metadata(False)
        job = sync.Sync("mihomo-codex", GH(), GE(), self.fixture())
        with patch.object(sync, "git_run") as git:
            with self.assertRaisesRegex(sync.SyncError, "Private GitHub"):
                job.sync_refs()
            git.assert_not_called()

    def test_wrong_owner_name_and_unknown_visibility_fail_closed(self):
        source = metadata(True, "CMMUU")
        for target in (metadata(True, "other"), metadata(True, repo="other"), metadata("false")):
            with self.subTest(target=target):
                with self.assertRaises(sync.SyncError):
                    sync.validate_pair("mihomo-codex", source, target)
        sync.validate_pair("mihomo-codex", source, metadata(True))

    def test_gitee_repository_url_accepts_only_exact_web_or_clone_url(self):
        source = metadata(False, "CMMUU")
        base = "https://gitee.com/cmmuu/mihomo-codex"
        for url in (base, base + ".git"):
            with self.subTest(url=url):
                sync.validate_pair("mihomo-codex", source, {**metadata(), "html_url": url})
        for url in (base + ".git.attacker", base + ".git/other", base + "/", base + "?other=repo",
                    "https://gitee.com/cmmuu/other", "https://gitee.com/other/mihomo-codex",
                    "https://gitee.com.attacker/cmmuu/mihomo-codex", base.replace("https:", "http:")):
            with self.subTest(url=url):
                with self.assertRaisesRegex(sync.SyncError, "target path"):
                    sync.validate_pair("mihomo-codex", source, {**metadata(), "html_url": url})

    def test_public_repository_does_not_bypass_authenticated_owner_preflight(self):
        class GH:
            def request(self, path):
                return metadata(False, "CMMUU", "mihomo-codex")
        class GE:
            identity = {"login": "other-owner"}
            def request(self, path):
                if path == "/user":
                    if isinstance(self.identity, Exception):
                        raise self.identity
                    return self.identity
                return metadata(False, repo="mihomo-codex")
        ge = GE()
        job = sync.Sync("mihomo-codex", GH(), ge, self.fixture())
        with patch.object(sync, "git_run") as git:
            for identity in ({}, {"login": "other-owner"}, sync.SyncError("Bearer rejected")):
                ge.identity = identity
                with self.assertRaises(sync.SyncError):
                    job.sync_refs()
            git.assert_not_called()
        ge.identity = {"login": "CMMUU"}
        self.assertEqual(job.guard()["path"], "mihomo-codex")

    def test_redirect_never_forwards_auth_and_unknown_host_is_rejected(self):
        data = b"verified package"
        api = sync.Api("github", "offline-secret")
        api.opener = Opener([
            HTTPError("https://api.github.com/asset", 302, "redirect", {"Location": "https://release-assets.githubusercontent.com/file?signature=example"}, None),
            Response(data),
        ])
        path = self.fixture() / "file.zip"
        api.download("/repos/CMMUU/mihomo-codex/releases/assets/1", path, len(data), hashlib.sha256(data).hexdigest())
        self.assertEqual(api.opener.requests[0].get_header("Authorization"), "Bearer offline-secret")
        self.assertIsNone(api.opener.requests[1].get_header("Authorization"))
        self.assertEqual(path.read_bytes(), data)
        api.opener = Opener([HTTPError("https://api.github.com/asset", 302, "redirect", {"Location": "https://attacker.example/file"}, None)])
        with self.assertRaisesRegex(sync.SyncError, "Untrusted"):
            api.download("/asset", self.fixture() / "file.zip", 1, "a" * 64)
        self.assertEqual(len(api.opener.requests), 1)
        for url in ("http://gitee.com/file", "https://gitee.com.attacker.example/file", "https://user@gitee.com/file", "https://gitee.com:444/file"):
            with self.assertRaises(sync.SyncError):
                sync.checked_url(url, {"gitee.com"})

    def test_corrupt_or_truncated_download_never_becomes_final_file(self):
        for payload in (b"bad", b"good-extra", b"goo"):
            api = sync.Api("github", "offline-secret")
            api.opener = Opener([Response(payload)])
            directory = self.fixture()
            with self.assertRaises(sync.SyncError):
                api.download("/asset", directory / "file.zip", 4, hashlib.sha256(b"good").hexdigest())
            self.assertEqual(list(directory.iterdir()), [])

    def test_gitee_default_storage_redirect_strips_credentials_and_custom_hosts_are_additive(self):
        data = b"good"
        digest = hashlib.sha256(data).hexdigest()
        api = sync.Api("gitee", "offline-secret", {"extra-storage.example"})
        self.assertEqual(api.storage_hosts, {"foruda.gitee.com", "extra-storage.example"})
        api.opener = Opener([
            HTTPError("https://gitee.com/api/v5/asset", 302, "redirect",
                      {"Location": "https://foruda.gitee.com/attach/package.zip?signature=example"}, None),
            Response(data),
        ])
        path = self.fixture() / "package.zip"
        api.download("/asset", path, len(data), digest)
        self.assertEqual(api.opener.requests[0].get_header("Authorization"), "Bearer offline-secret")
        self.assertIsNone(api.opener.requests[1].get_header("Authorization"))
        self.assertEqual(path.read_bytes(), data)

    def test_protocol_errors_do_not_expose_signed_urls_or_credentials(self):
        for binary in (False, True):
            api = sync.Api("github", "offline-secret")
            api.opener = Opener([http.client.InvalidURL("signed-url?secret=offline-secret")] * sync.READ_ATTEMPTS)
            with self.assertRaises(sync.SyncError) as error, patch.object(sync.time, "sleep"):
                if binary:
                    api.download("/asset", self.fixture() / "file.zip", 1, "a" * 64)
                else:
                    api.request("/repos/CMMUU/mihomo-codex")
            self.assertNotIn("offline-secret", str(error.exception))
            self.assertNotIn("signed-url", str(error.exception))

    def attachment_job(self, existing=None, copies=1):
        root = self.fixture()
        source = root / "package.zip"
        source.write_bytes(b"good")
        ge = GiteeFixture(existing, copies)
        job = sync.Sync("mihomo-codex", None, ge, root)
        job.guard = lambda: None
        item = {"path": source, "name": source.name, "size": 4, "sha256": hashlib.sha256(b"good").hexdigest()}
        return job, ge, item

    def test_identical_existing_attachment_is_verified_and_not_uploaded_again(self):
        job, ge, item = self.attachment_job(b"good")
        job.ensure_attachment(1, item)
        self.assertEqual(ge.uploads, 0)

    def test_conflicting_or_duplicate_attachment_is_never_overwritten(self):
        for content, copies in ((b"evil", 1), (b"good", 2)):
            job, ge, item = self.attachment_job(content, copies)
            with self.assertRaises(sync.SyncError):
                job.ensure_attachment(1, item)
            self.assertEqual(ge.uploads, 0)
            self.assertEqual(ge.content, content)

    def test_missing_attachment_uploads_once_then_is_download_verified_and_reusable(self):
        job, ge, item = self.attachment_job()
        job.ensure_attachment(1, item)
        job.ensure_attachment(1, item)
        self.assertEqual(ge.uploads, 1)
        self.assertEqual(ge.content, b"good")

    def test_uncertain_upload_is_reconciled_before_any_second_post(self):
        job, ge, item = self.attachment_job()
        original_upload = ge.upload
        def uncertain(path, file):
            original_upload(path, file)
            raise sync.SyncError("Upload outcome uncertain")
        ge.upload = uncertain
        with self.assertRaises(sync.SyncError):
            job.ensure_attachment(1, item)
        job.ensure_attachment(1, item)
        self.assertEqual(ge.uploads, 1)

    def test_old_asset_cache_is_compared_with_fresh_source_bytes(self):
        directory = self.fixture()
        cached = directory / "old.zip"
        cached.write_bytes(b"good")
        api = sync.Api("github", "offline-secret")
        api.opener = Opener([Response(b"good")])
        result = api.download("/asset", cached, 4)
        self.assertEqual(result, hashlib.sha256(b"good").hexdigest())
        self.assertEqual(len(api.opener.requests), 1)
        api.opener = Opener([Response(b"evil")])
        with self.assertRaisesRegex(sync.SyncError, "differs from the current source"):
            api.download("/asset", cached, 4)
        self.assertEqual(cached.read_bytes(), b"good")
        self.assertEqual(list(directory.iterdir()), [cached])

    def test_transient_reads_retry_but_writes_are_never_blindly_retried(self):
        api = sync.Api("gitee", "offline-secret")
        api.opener = Opener([
            HTTPError("https://gitee.com/api/v5/user", 429, "busy", {}, None),
            Response(json.dumps({"login": "cmmuu"}).encode()),
        ])
        with patch.object(sync.time, "sleep") as sleep:
            self.assertEqual(api.request("/user"), {"login": "cmmuu"})
            sleep.assert_called_once_with(1)
        api.opener = Opener([HTTPError("https://gitee.com/api/v5/releases", 503, "busy", {}, None)])
        with self.assertRaises(sync.SyncError), patch.object(sync.time, "sleep") as sleep:
            api.request("/releases", "POST", {"tag_name": "v1"})
        sleep.assert_not_called()
        self.assertEqual(len(api.opener.requests), 1)

    def capacity_job(self, size=4, existing=(), max_asset=10, max_total=10, reserved=0):
        release = {"id": 1, "tag_name": "v1", "draft": False}
        source_asset = {"id": 7, "name": "package.zip", "size": size, "state": "uploaded",
                        "url": "https://api.github.com/repos/CMMUU/mihomo-codex/releases/assets/7"}
        class GH:
            def pages(self, path):
                return [release] if path.endswith("/releases") else [source_asset]
        class GE:
            def pages(self, path):
                if path.endswith("/releases"):
                    return [{"id": 12, "tag_name": "v1"}] if existing else []
                return list(existing)
        job = sync.Sync("mihomo-codex", GH(), GE(), self.fixture(), max_asset, max_total, reserved)
        job.guard = lambda: None
        return job, release

    def test_capacity_overflow_preserves_ref_sync_but_blocks_release_writes(self):
        for size, per_file, total, reserved in ((11, 10, 100, 0), (9, 10, 10, 2)):
            job, _ = self.capacity_job(size=size, max_asset=per_file, max_total=total, reserved=reserved)
            with patch.object(job, "sync_refs") as refs, patch.object(job, "sync_release") as release, patch("builtins.print"):
                with self.assertRaises(sync.SyncError):
                    job.run("all", True)
                refs.assert_called_once_with()
                release.assert_not_called()

    def test_capacity_dry_run_never_syncs_refs_or_releases(self):
        for size in (4, 11):
            job, _ = self.capacity_job(size=size)
            with patch.object(job, "sync_refs") as refs, patch.object(job, "sync_release") as release, patch("builtins.print"):
                if size > 10:
                    with self.assertRaises(sync.SyncError):
                        job.run("all", False)
                else:
                    job.run("all", False)
                refs.assert_not_called()
                release.assert_not_called()

    def test_capacity_counts_existing_and_target_only_assets_without_double_counting(self):
        assets = [{"id": 1, "name": "package.zip", "size": 4}, {"id": 2, "name": "extra.zip", "size": 5}]
        job, release = self.capacity_job(existing=assets, max_total=10, reserved=1)
        with patch("builtins.print"):
            job.plan_release_capacity([release])
        job.other_attachment_bytes = 2
        with self.assertRaisesRegex(sync.SyncError, "capacity exceeded"):
            job.plan_release_capacity([release])

    def test_capacity_rejects_unknown_or_conflicting_destination_sizes(self):
        for existing in ([{"id": 1, "name": "package.zip"}], [{"id": 1, "name": "package.zip", "size": 5}]):
            job, release = self.capacity_job(existing=existing)
            with self.assertRaises(sync.SyncError):
                job.plan_release_capacity([release])

    def test_privacy_recheck_blocks_upload_when_visibility_changes(self):
        job, ge, item = self.attachment_job()
        def changed():
            sync.validate_pair("mihomo-codex", metadata(True, "CMMUU"), metadata(False))
        job.guard = changed
        with self.assertRaisesRegex(sync.SyncError, "Private GitHub"):
            job.ensure_attachment(1, item)
        self.assertEqual(ge.uploads, 0)

    def test_checksum_manifest_cannot_substitute_another_name_or_hash(self):
        directory = self.fixture()
        manifest = directory / "SHA256SUMS.txt"
        expected = hashlib.sha256(b"good").hexdigest()
        rows = [{"name": "SHA256SUMS.txt", "path": manifest}, {"name": "package.zip", "sha256": expected}]
        manifest.write_text(expected + "  package.zip\n", encoding="utf-8")
        sync.verify_manifest(rows)
        for value in (expected + "  other.zip\n", "0" * 64 + "  package.zip\n", (expected + "  package.zip\n") * 2):
            manifest.write_text(value, encoding="utf-8")
            with self.assertRaises(sync.SyncError):
                sync.verify_manifest(rows)

    def test_github_write_is_rejected_without_contacting_network(self):
        api = sync.Api("github", "offline-secret")
        api.opener = Opener([])
        with self.assertRaisesRegex(sync.SyncError, "GitHub writes"):
            api.request("/repos/CMMUU/mihomo-codex/releases", "DELETE")
        self.assertEqual(api.opener.requests, [])

    def test_ref_sync_copies_all_heads_and_tags_without_force_or_remote_deletion(self):
        job = sync.Sync("mihomo-codex", None, None, self.fixture())
        job.guard = lambda: None
        calls = []
        refs = {"refs/heads/main": "a" * 40, "refs/heads/topic": "b" * 40, "refs/tags/v0.4.0": "c" * 40}
        def git(repo, *args):
            calls.append(args)
            if "for-each-ref" in args:
                return "\n".join(f"{ref} {sha}" for ref, sha in refs.items())
            if "ls-remote" in args:
                return "\n".join(f"{sha}\t{ref}" for ref, sha in refs.items())
            return ""
        with patch.object(sync, "git_run", side_effect=git):
            job.sync_refs()
        pushes = [args for args in calls if "push" in args]
        self.assertEqual(len(pushes), 1)
        self.assertEqual(pushes[0][-2:], ("refs/heads/*:refs/heads/*", "refs/tags/*:refs/tags/*"))
        self.assertIn("--atomic", pushes[0])
        self.assertFalse(any(option in pushes[0] for option in ("--force", "--mirror", "--prune", "--delete")))

    def test_release_title_body_and_attachment_are_copied_once_then_reused(self):
        data = b"good"
        digest = hashlib.sha256(data).hexdigest()
        class GH:
            def request(self, path):
                return metadata(True, "CMMUU")
            def pages(self, path):
                return [{"id": 7, "name": "package.zip", "state": "uploaded", "size": 4,
                         "digest": "sha256:" + digest,
                         "url": "https://api.github.com/repos/CMMUU/mihomo-codex/releases/assets/7"}]
            def download(self, path, destination, expected_size, expected_sha):
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(data)
                return digest
        class GE(GiteeFixture):
            def __init__(self):
                super().__init__()
                self.release, self.creates, self.updates = None, 0, 0
            def request(self, path, method="GET", data=None):
                if method == "GET":
                    if path == "/user":
                        return {"login": "cmmuu"}
                    if path.endswith("/releases/12"):
                        return self.release
                    return metadata(True)
                if method == "POST":
                    self.creates += 1
                    self.release = {**data, "id": 12, "prerelease": data["prerelease"] == "true"}
                elif method == "PATCH":
                    self.updates += 1
                    self.release.update(data)
                return self.release
            def pages(self, path):
                if path.endswith("/releases"):
                    return [self.release] if self.release else []
                return super().pages(path)
        ge = GE()
        job = sync.Sync("mihomo-codex", GH(), ge, self.fixture())
        release = {"id": 1, "tag_name": "v0.4.0", "name": "准确标题", "body": "原正文\n第二行", "prerelease": False, "draft": False}
        with patch.object(sync, "git_run", return_value="a" * 40), patch("builtins.print"):
            job.sync_release(release, job.work / "fixture.git")
            job.sync_release(release, job.work / "fixture.git")
        self.assertEqual((ge.creates, ge.updates, ge.uploads), (1, 0, 1))
        self.assertEqual(ge.release["name"], release["name"])
        self.assertEqual(ge.release["body"], release["body"])
        self.assertEqual(ge.release["target_commitish"], "a" * 40)


    def release_metadata_job(self, source_body, existing_body=None, read_back_body=None):
        source = {"id": 1, "tag_name": "v0.5.0", "name": "Release notes", "body": source_body,
                  "prerelease": False, "draft": False}
        class GE:
            def __init__(self):
                self.release = None if existing_body is None else {**source, "id": 12, "body": existing_body}
                self.writes = []
            def pages(self, path):
                return [self.release] if self.release else []
            def request(self, path, method="GET", data=None):
                if method != "GET":
                    self.writes.append((method, dict(data)))
                    self.release = {**data, "id": 12, "prerelease": data["prerelease"] == "true"}
                result = dict(self.release)
                result["body"] = (read_back_body if read_back_body is not None else result["body"]).replace("\r\n", "\n").replace("\n", "\r\n")
                return result
        ge = GE()
        job = sync.Sync("mihomo-codex", None, ge, self.fixture())
        job.guard = lambda: None
        job.source_assets = lambda release: []
        return job, ge, source

    def test_existing_release_with_crlf_body_is_reused_without_patch(self):
        body = "First line  \nSecond line\n"
        job, ge, source = self.release_metadata_job(body, body.replace("\n", "\r\n"))
        with patch.object(sync, "git_run", return_value="a" * 40), patch("builtins.print"):
            job.sync_release(source, job.work / "fixture.git")
            job.sync_release(source, job.work / "fixture.git")
        self.assertEqual(ge.writes, [])

    def test_crlf_api_read_back_accepts_create_and_patch_without_changing_source_body(self):
        for existing, method in ((None, "POST"), ("Old release notes", "PATCH")):
            for body in ("First line  \nSecond line\n", "First line  \r\nSecond line\r\n"):
                with self.subTest(method=method, body=body):
                    job, ge, source = self.release_metadata_job(body, existing)
                    with patch.object(sync, "git_run", return_value="a" * 40), patch("builtins.print"):
                        job.sync_release(source, job.work / "fixture.git")
                    self.assertEqual(len(ge.writes), 1)
                    self.assertEqual(ge.writes[0][0], method)
                    self.assertEqual(ge.writes[0][1]["body"], body)

    def test_body_content_and_markdown_whitespace_changes_are_updated(self):
        body = "First line  \nSecond line\n"
        for changed in (body.replace("Second", "Different"), body.replace("  \n", "\n"), body.rstrip("\n")):
            with self.subTest(changed=changed):
                job, ge, source = self.release_metadata_job(body, changed)
                with patch.object(sync, "git_run", return_value="a" * 40), patch("builtins.print"):
                    job.sync_release(source, job.work / "fixture.git")
                self.assertEqual(len(ge.writes), 1)
                self.assertEqual(ge.writes[0][0], "PATCH")
                self.assertEqual(ge.writes[0][1]["body"], body)

    def test_read_back_still_rejects_changed_content_or_markdown_whitespace(self):
        body = "First line  \nSecond line\n"
        for changed in (body.replace("Second", "Different"), body.replace("  \n", "\n"), body.rstrip("\n")):
            with self.subTest(changed=changed):
                job, ge, source = self.release_metadata_job(body, body, changed)
                with patch.object(sync, "git_run", return_value="a" * 40), patch("builtins.print"):
                    with self.assertRaisesRegex(sync.SyncError, "metadata did not match"):
                        job.sync_release(source, job.work / "fixture.git")
                self.assertEqual(ge.writes, [])


if __name__ == "__main__":
    unittest.main()
