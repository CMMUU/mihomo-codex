# Third-party notices

## Mihomo

- Project: https://github.com/MetaCubeX/mihomo
- Bundled version: 1.19.30
- License: GNU General Public License v3 (GPL-3.0)
- Upstream license: https://github.com/MetaCubeX/mihomo/blob/v1.19.30/LICENSE
- Corresponding upstream source: https://github.com/MetaCubeX/mihomo/archive/refs/tags/v1.19.30.tar.gz
- The matching source archive is also attached to the application release as `mihomo-v1.19.30-source.tar.gz`.
- License text: [third-party/Mihomo-LICENSE.txt](third-party/Mihomo-LICENSE.txt)

## sysinfo

- Project: https://github.com/GuillaumeGomez/sysinfo
- Linked version: 0.39.6
- License: MIT
- Use: cross-platform aggregate network-interface byte counters

## fontdue

- Project: https://github.com/mooman219/fontdue
- Linked version: 0.9.4 on macOS
- License: Apache-2.0 OR MIT OR Zlib
- Use: antialiased system-font rasterization for the dynamic macOS status item

The application build also contains Rust crates and npm dependencies governed by
their respective licenses. Release automation must generate a dependency SBOM
and license inventory before public distribution.

## Application and dependency inventory

The application source is licensed under [GPL-3.0-only](LICENSE) from
2026-09-04. This does not replace or relicense third-party components.

The v0.5.0 lockfile inventory is available as a
[CycloneDX SBOM](docs/compliance/v0.5.0/sbom.cdx.json) and a
[readable license inventory](docs/compliance/v0.5.0/license-inventory.md).
It records exact versions, declared licenses, package source links and available
archive checksums for all locked Rust and npm dependencies, plus the bundled
Mihomo version. It includes optional, build, development and other-platform
packages; it is not an assertion that every listed package occurs in each
installer. System libraries, platform WebViews and the internal Go dependency
graph of the separately distributed upstream Mihomo core are outside this
lockfile inventory; the core's matching source archive includes its own source,
dependency declarations and license notices.

Regenerate these files after changing a version, lockfile or core manifest:

```sh
python scripts/generate_compliance.py
```

The generator requires Python 3.11 or newer and Cargo. It uses locked Cargo
metadata across platforms and fails if a package lacks license metadata or the
metadata does not cover the lockfile. Review the generated license declarations
and retain the original upstream notices and required source when distributing
third-party components.
