import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

from publish_github_release import (ReleaseError, collect_packages, package_names,
                                    prepare_assets, publish, sha256, validate_version)


COMMIT = "a" * 40
TAG = "v0.5.0"
ENDPOINT = "/repos/CMMUU/mihomo-codex/releases"


class FakeGitHub:
    def __init__(self):
        self.release = None
        self.assets = []
        self.writes = []
        self.uploads = []
        self.fail_upload = False
        self.commit = COMMIT
        self.move_after_upload = False

    def api(self, path, method="GET", data=None):
        if "/git/ref/tags/" in path:
            return {"object": {"type": "tag", "sha": "b" * 40}}
        if "/git/tags/" in path:
            return {"object": {"type": "commit", "sha": self.commit}}
        if method == "GET" and path == ENDPOINT + "/1":
            return self.release.copy()
        self.writes.append((method, data))
        if method == "POST" and path == ENDPOINT:
            self.release = {**data, "id": 1}
        elif method == "PATCH" and path == ENDPOINT + "/1":
            self.release.update(data)
        else:
            raise AssertionError((path, method))
        return self.release.copy()

    def pages(self, path):
        if path == ENDPOINT:
            return [self.release.copy()] if self.release else []
        if path == ENDPOINT + "/1/assets":
            return [asset.copy() for asset in self.assets]
        raise AssertionError(path)

    def upload(self, release_id, path):
        if self.fail_upload:
            raise ReleaseError("Simulated upload failure")
        asset = {"name": path.name, "size": path.stat().st_size, "state": "uploaded",
                 "digest": "sha256:" + sha256(path), "id": len(self.assets) + 1}
        self.assets.append(asset)
        self.uploads.append(path.name)
        if self.move_after_upload:
            self.commit = "c" * 40
        return asset.copy()

    def digest(self, asset):
        return asset["digest"].removeprefix("sha256:")


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "repo"
        self.artifacts = self.base / "artifacts"
        self.output = self.base / "release"
        for folder in ("src-tauri", "third-party", "docs"):
            (self.root / folder).mkdir(parents=True)
        for path in ("package.json", "src-tauri/tauri.conf.json"):
            (self.root / path).write_text(json.dumps({"version": "0.5.0"}), encoding="utf-8")
        (self.root / "src-tauri/Cargo.toml").write_text('[package]\nversion = "0.5.0"\n', encoding="utf-8")
        (self.root / "docs/发布说明-v0.5.0.md").write_text("Reviewed notes\n", encoding="utf-8")
        self.license = b"GPL source license fixture\n"
        (self.root / "third-party/Mihomo-LICENSE.txt").write_bytes(self.license)
        self.manifest = {
            "version": "1.19.30", "license": "GPL-3.0",
            "licenseSha256": hashlib.sha256(self.license).hexdigest(),
            "sourceUrl": "https://github.com/MetaCubeX/mihomo/archive/refs/tags/v1.19.30.tar.gz",
        }
        self.write_manifest()
        for platform, names in package_names("0.5.0").items():
            folder = self.artifacts / platform / "bundle"
            folder.mkdir(parents=True)
            for name in names:
                (folder / name).write_bytes(f"Built package: {name}".encode())

    def write_manifest(self):
        (self.root / "src-tauri/core-manifest.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def fetch_source(self, url, destination):
        self.assertEqual(url, self.manifest["sourceUrl"])
        with tarfile.open(destination, "w:gz") as archive:
            member = tarfile.TarInfo("mihomo-1.19.30/LICENSE")
            member.size = len(self.license)
            archive.addfile(member, io.BytesIO(self.license))

    def prepare(self):
        return prepare_assets(self.root, self.artifacts, self.output, TAG, self.fetch_source)

    def test_complete_platform_set_produces_fifteen_assets_and_exact_checksums(self):
        assets, notes = self.prepare()
        self.assertEqual(len(assets), 15)
        self.assertEqual(notes, "Reviewed notes\n")
        expected = {path.name: sha256(path) for path in assets if path.name != "SHA256SUMS.txt"}
        actual = {line.split("  ", 1)[1]: line.split("  ", 1)[0]
                  for line in (self.output / "SHA256SUMS.txt").read_text().splitlines()}
        self.assertEqual(actual, expected)
        self.assertNotIn(b"\r", (self.output / "SHA256SUMS.txt").read_bytes())

    def test_missing_one_platform_package_prevents_staging(self):
        next((self.artifacts / "windows-x64").rglob("*.msi")).unlink()
        with self.assertRaisesRegex(ReleaseError, "Missing"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_duplicate_filename_or_wrong_version_package_is_rejected(self):
        sample = next((self.artifacts / "macos-x64").rglob("*.dmg"))
        (sample.parent.parent / sample.name).write_bytes(sample.read_bytes())
        with self.assertRaisesRegex(ReleaseError, "duplicated"):
            collect_packages(self.artifacts, "0.5.0")

    def test_tag_version_mismatch_is_rejected(self):
        with self.assertRaisesRegex(ReleaseError, "versions"):
            validate_version(self.root, "v0.6.0")

    def test_missing_reviewed_notes_is_rejected(self):
        (self.root / "docs/发布说明-v0.5.0.md").unlink()
        with self.assertRaisesRegex(ReleaseError, "Reviewed release notes"):
            self.prepare()

    def test_core_license_mismatch_is_rejected(self):
        (self.root / "third-party/Mihomo-LICENSE.txt").write_bytes(b"Changed license")
        with self.assertRaisesRegex(ReleaseError, "manifest"):
            self.prepare()

    def test_source_url_cannot_be_redirected_to_unrelated_origin_in_manifest(self):
        self.manifest["sourceUrl"] = "https://example.com/untrusted.tar.gz"
        self.write_manifest()
        with self.assertRaisesRegex(ReleaseError, "manifest"):
            self.prepare()

    def test_downloaded_source_must_contain_matching_license(self):
        self.license = b"GPL source license WRONG!!\n"
        with self.assertRaisesRegex(ReleaseError, "license"):
            self.prepare()

    def test_success_creates_draft_then_publishes_and_rerun_writes_nothing(self):
        assets, notes = self.prepare()
        api = FakeGitHub()
        publish(api, TAG, COMMIT, assets, notes)
        self.assertEqual(len(api.uploads), 15)
        self.assertTrue(api.writes[0][1]["draft"])
        self.assertFalse(api.writes[-1][1]["draft"])
        self.assertFalse(api.release["draft"])
        api.writes.clear()
        api.uploads.clear()
        api.release.update({"name": "Maintainer-edited title", "body": "Maintainer-edited published notes"})
        publish(api, TAG, COMMIT, assets, notes)
        self.assertEqual(api.writes, [])
        self.assertEqual(api.uploads, [])
        self.assertEqual(api.release["name"], "Maintainer-edited title")
        self.assertEqual(api.release["body"], "Maintainer-edited published notes")

    def test_existing_placeholder_draft_is_published_with_reviewed_title_and_notes(self):
        assets, notes = self.prepare()
        api = FakeGitHub()
        api.release = {"id": 1, "tag_name": TAG, "draft": True, "prerelease": False,
                       "name": "Work in progress", "body": "TODO: release notes"}
        publish(api, TAG, COMMIT, assets, notes)
        self.assertEqual(len(api.writes), 1)
        method, payload = api.writes[0]
        self.assertEqual(method, "PATCH")
        self.assertFalse(payload["draft"])
        self.assertEqual(payload["name"], f"mihomo-codex {TAG}")
        self.assertEqual(payload["body"], notes)
        self.assertEqual(api.release["name"], f"mihomo-codex {TAG}")
        self.assertEqual(api.release["body"], notes)

    def test_upload_failure_leaves_draft_and_retry_resumes(self):
        assets, notes = self.prepare()
        api = FakeGitHub()
        api.fail_upload = True
        with self.assertRaisesRegex(ReleaseError, "upload failure"):
            publish(api, TAG, COMMIT, assets, notes)
        self.assertTrue(api.release["draft"])
        api.fail_upload = False
        api.upload(1, assets[0])
        publish(api, TAG, COMMIT, assets, notes)
        self.assertEqual(len(api.uploads), 15)
        self.assertFalse(api.release["draft"])

    def test_existing_content_conflict_blocks_every_upload_and_metadata_change(self):
        assets, notes = self.prepare()
        api = FakeGitHub()
        api.release = {"id": 1, "tag_name": TAG, "draft": True, "prerelease": False}
        api.upload(1, assets[-1])
        api.assets[-1]["digest"] = "sha256:" + "0" * 64
        api.uploads.clear()
        with self.assertRaisesRegex(ReleaseError, "conflict"):
            publish(api, TAG, COMMIT, assets, notes)
        self.assertEqual(api.uploads, [])
        self.assertEqual(api.writes, [])

    def test_remote_tag_mismatch_blocks_release_creation(self):
        assets, notes = self.prepare()
        api = FakeGitHub()
        api.commit = "c" * 40
        with self.assertRaisesRegex(ReleaseError, "build commit"):
            publish(api, TAG, COMMIT, assets, notes)
        self.assertEqual(api.writes, [])

    def test_tag_moved_during_upload_leaves_draft_unpublished(self):
        assets, notes = self.prepare()
        api = FakeGitHub()
        api.move_after_upload = True
        with self.assertRaisesRegex(ReleaseError, "build commit"):
            publish(api, TAG, COMMIT, assets, notes)
        self.assertTrue(api.release["draft"])
        self.assertEqual(len(api.writes), 1)


if __name__ == "__main__":
    unittest.main()
