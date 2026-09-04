#!/usr/bin/env python3
"""Publish the complete six-platform bundle set, without replacing release assets."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import tomllib
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


REPOSITORY = "CMMUU/mihomo-codex"
MAX_SOURCE_BYTES = 256 * 1024 * 1024


class ReleaseError(Exception):
    pass


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def package_names(version):
    prefix = f"mihomo-codex_{version}"
    return {
        "macos-aarch64": [f"{prefix}_aarch64.dmg"],
        "macos-x64": [f"{prefix}_x64.dmg"],
        "windows-x64": [f"{prefix}_x64-setup.exe", f"{prefix}_x64_en-US.msi"],
        "windows-arm64": [f"{prefix}_arm64-setup.exe", f"{prefix}_arm64_en-US.msi"],
        "linux-x64": [f"{prefix}_amd64.AppImage", f"{prefix}_amd64.deb",
                      f"mihomo-codex-{version}-1.x86_64.rpm"],
        "linux-arm64": [f"{prefix}_aarch64.AppImage", f"{prefix}_arm64.deb",
                        f"mihomo-codex-{version}-1.aarch64.rpm"],
    }


def validate_version(root, tag):
    if not re.fullmatch(r"v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", tag):
        raise ReleaseError("Automatic publishing requires a stable vX.Y.Z tag")
    version = tag[1:]
    versions = [json.loads((root / path).read_text(encoding="utf-8"))["version"]
                for path in ("package.json", "src-tauri/tauri.conf.json")]
    versions.append(tomllib.loads((root / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))["package"]["version"])
    if any(value != version for value in versions):
        raise ReleaseError("Release tag does not match all application versions")
    notes = root / "docs" / f"发布说明-{tag}.md"
    if not notes.is_file() or not notes.read_text(encoding="utf-8").strip():
        raise ReleaseError(f"Reviewed release notes are required: docs/发布说明-{tag}.md")
    return version, notes.read_text(encoding="utf-8")


def collect_packages(artifacts, version):
    expected = package_names(version)
    if {path.name for path in artifacts.iterdir()} != set(expected):
        raise ReleaseError("Exactly six platform artifact directories are required")
    result = []
    for platform, names in expected.items():
        folder = artifacts / platform
        if not folder.is_dir() or folder.is_symlink():
            raise ReleaseError(f"Invalid artifact directory: {platform}")
        candidates = [path for path in folder.rglob("*")
                      if path.suffix in {".dmg", ".exe", ".msi", ".AppImage", ".deb", ".rpm"}]
        if sorted(path.name for path in candidates) != sorted(names):
            raise ReleaseError(f"Missing, duplicated or unexpected packages in {platform}")
        for path in candidates:
            if not path.is_file() or path.is_symlink() or not path.stat().st_size:
                raise ReleaseError(f"Invalid or empty package: {path.name}")
        result.extend(candidates)
    return result


class SourceRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlparse(newurl)
        if target.scheme != "https" or target.hostname not in {"github.com", "codeload.github.com"}:
            raise ReleaseError("Unexpected upstream source redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_source(url, destination):
    opener = build_opener(SourceRedirects())
    request = Request(url, headers={"User-Agent": "mihomo-codex-release"})
    total = 0
    with opener.open(request, timeout=120) as response, destination.open("wb") as output:
        while block := response.read(1024 * 1024):
            total += len(block)
            if total > MAX_SOURCE_BYTES:
                raise ReleaseError("Upstream source exceeds the download limit")
            output.write(block)


def prepare_assets(root, artifacts, output, tag, fetch_source=download_source):
    version, notes = validate_version(root, tag)
    packages = collect_packages(artifacts, version)
    manifest = json.loads((root / "src-tauri/core-manifest.json").read_text(encoding="utf-8"))
    core = manifest["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", core):
        raise ReleaseError("Invalid bundled core version")
    source_url = f"https://github.com/MetaCubeX/mihomo/archive/refs/tags/v{core}.tar.gz"
    license_path = root / "third-party/Mihomo-LICENSE.txt"
    if (manifest.get("sourceUrl") != source_url or manifest.get("license") != "GPL-3.0"
            or sha256(license_path) != manifest.get("licenseSha256")):
        raise ReleaseError("Bundled source or license does not match the core manifest")
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ReleaseError("The release staging directory must be empty")
    for path in packages:
        shutil.copyfile(path, output / path.name)
    shutil.copyfile(license_path, output / f"Mihomo-LICENSE-v{core}.txt")
    source_path = output / f"mihomo-v{core}-source.tar.gz"
    fetch_source(source_url, source_path)
    with tarfile.open(source_path, "r:gz") as archive:
        member = archive.getmember(f"mihomo-{core}/LICENSE")
        if not member.isfile() or member.size != license_path.stat().st_size:
            raise ReleaseError("Upstream source does not contain the matching core license")
        if archive.extractfile(member).read() != license_path.read_bytes():
            raise ReleaseError("Upstream source license differs from the bundled core license")
    assets = sorted(output.iterdir(), key=lambda path: path.name)
    checksums = output / "SHA256SUMS.txt"
    checksums.write_text("".join(f"{sha256(path)}  {path.name}\n" for path in assets), encoding="utf-8", newline="\n")
    return [*assets, checksums], notes


class GitHub:
    """Use gh's supported authentication and private-asset redirect handling."""

    def command(self, args, *, data=None, output=None):
        result = subprocess.run(["gh", *args], input=data, stdout=output or subprocess.PIPE,
                                stderr=subprocess.PIPE, check=False)
        if result.returncode:
            # Do not print request bodies, token-bearing environments or signed download URLs.
            raise ReleaseError(f"GitHub CLI request failed (exit {result.returncode}); no assets were replaced")
        return result.stdout

    def api(self, path, method="GET", data=None):
        args = ["api", path, "--method", method]
        payload = None
        if data is not None:
            args.extend(["--input", "-"])
            payload = json.dumps(data).encode("utf-8")
        return json.loads(self.command(args, data=payload))

    def pages(self, path):
        rows = []
        for page in range(1, 1001):
            batch = self.api(f"{path}?per_page=100&page={page}")
            rows.extend(batch)
            if len(batch) < 100:
                return rows
        raise ReleaseError("GitHub pagination limit reached")

    def upload(self, release_id, path):
        endpoint = f"https://uploads.github.com/repos/{REPOSITORY}/releases/{release_id}/assets?name={quote(path.name)}"
        return json.loads(self.command(["api", endpoint, "--method", "POST", "--input", str(path),
                                        "-H", "Content-Type: application/octet-stream"]))

    def digest(self, asset):
        digest = asset.get("digest") or ""
        if re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
            return digest.removeprefix("sha256:")
        with tempfile.TemporaryFile() as output:
            self.command(["api", f"/repos/{REPOSITORY}/releases/assets/{int(asset['id'])}",
                          "-H", "Accept: application/octet-stream"], output=output)
            output.seek(0)
            return hashlib.file_digest(output, "sha256").hexdigest()


def verify_tag(api, tag, commit):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ReleaseError("A full build commit SHA is required")
    obj = api.api(f"/repos/{REPOSITORY}/git/ref/tags/{quote(tag, safe='')}")["object"]
    for _ in range(10):
        if obj["type"] != "tag":
            break
        obj = api.api(f"/repos/{REPOSITORY}/git/tags/{obj['sha']}")["object"]
    if obj["type"] != "commit" or obj["sha"] != commit:
        raise ReleaseError("Remote release tag no longer matches the build commit")


def verify_asset(api, remote, path):
    if (remote.get("state") != "uploaded" or remote.get("size") != path.stat().st_size
            or api.digest(remote) != sha256(path)):
        raise ReleaseError(f"Asset content conflict or incomplete upload: {path.name}; refusing replacement")


def publish(api, tag, commit, assets, notes):
    verify_tag(api, tag, commit)
    endpoint = f"/repos/{REPOSITORY}/releases"
    releases = [release for release in api.pages(endpoint) if release.get("tag_name") == tag]
    if len(releases) > 1:
        raise ReleaseError("More than one release exists for the tag")
    release = releases[0] if releases else api.api(endpoint, "POST", {
        "tag_name": tag, "target_commitish": commit, "name": f"mihomo-codex {tag}",
        "body": notes, "draft": True, "prerelease": False,
    })
    if release.get("tag_name") != tag or release.get("prerelease"):
        raise ReleaseError("Unexpected release metadata")
    release_id = int(release["id"])
    asset_endpoint = f"{endpoint}/{release_id}/assets"
    remote = api.pages(asset_endpoint)
    existing = {asset["name"]: asset for asset in remote}
    expected = {path.name for path in assets}
    if len(existing) != len(remote) or set(existing) - expected:
        raise ReleaseError("Unexpected or duplicated existing release assets; refusing to modify")
    # Check all existing names before any upload, so reruns never overwrite old builds.
    for path in assets:
        if path.name in existing:
            verify_asset(api, existing[path.name], path)
    for path in assets:
        if path.name not in existing:
            uploaded = api.upload(release_id, path)
            if uploaded.get("name") != path.name:
                raise ReleaseError("Uploaded asset name changed unexpectedly")
            verify_asset(api, uploaded, path)
    remote = api.pages(asset_endpoint)
    if len(remote) != len(assets) or {asset["name"] for asset in remote} != expected:
        raise ReleaseError("Release asset set is incomplete; leaving draft unpublished")
    by_name = {asset["name"]: asset for asset in remote}
    for path in assets:
        verify_asset(api, by_name[path.name], path)
    verify_tag(api, tag, commit)
    if release.get("draft"):
        api.api(f"{endpoint}/{release_id}", "PATCH", {
            "name": f"mihomo-codex {tag}", "body": notes,
            "draft": False, "make_latest": "legacy",
        })
    confirmed = api.api(f"{endpoint}/{release_id}")
    if confirmed.get("draft") is not False or confirmed.get("tag_name") != tag:
        raise ReleaseError("GitHub did not confirm release publication")
    if release.get("draft") and (confirmed.get("name") != f"mihomo-codex {tag}" or confirmed.get("body") != notes):
        raise ReleaseError("GitHub did not confirm the reviewed release title and notes")
    print(f"Published and verified {tag}: {len(assets)} assets")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if os.environ.get("GITHUB_REPOSITORY", REPOSITORY) != REPOSITORY:
        raise ReleaseError("Publishing is restricted to CMMUU/mihomo-codex")
    root = Path(__file__).resolve().parent.parent
    if args.apply:
        checked_out = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"],
                                     capture_output=True, text=True, check=False)
        if checked_out.returncode or checked_out.stdout.strip() != args.commit:
            raise ReleaseError("The checked-out source does not match the build commit")
    assets, notes = prepare_assets(root, args.artifacts, args.output, args.tag)
    if args.apply:
        publish(GitHub(), args.tag, args.commit, assets, notes)
    else:
        print(f"Prepared {len(assets)} release assets; no GitHub changes without --apply")


if __name__ == "__main__":
    try:
        main()
    except (ReleaseError, OSError, ValueError, KeyError, tarfile.TarError) as error:
        raise SystemExit(f"Release failed: {error}")
