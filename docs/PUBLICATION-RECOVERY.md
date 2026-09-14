# Verify an accepted npm release without publishing again

A successful `npm publish` submission is not sufficient evidence that the package is publicly installable. The release pipeline separately compares public registry integrity and downloaded tarball bytes against the existing GitHub release. Keep those checks enabled.

If a submission succeeds but public lookup stays HTTP 404, inspect its state before rerunning publication. In the 0.5.0 release, a repeated submission returned `E409: Cannot publish over previously staged version "0.5.0"`. That response establishes an existing staged version; it does not by itself identify whether the delay is registry processing or a maintainer-approval requirement.

## Read-only recovery

Run **Verify existing npm release** in GitHub Actions (`.github/workflows/npm-verify.yml`) with the existing release tag, for example `v0.5.0`. The workflow checks out that tag, validates the package name/version and existing archive checksum, and downloads the public npm tarball for exact SHA-512 comparison. When metadata is initially missing, it requests read-only staging diagnostics for this package with the existing npm credential, exposing only selected identity/status fields. Diagnostics may be unavailable with some credential types; the independent public-byte verification still runs.

This workflow never publishes, approves or rejects a staged version, changes npm permissions, moves a tag, or rebuilds release assets. Its successful conclusion means the public registry bytes match the original release. A failed conclusion must not be described as a verified public publication.

## Maintainer approval

Where npm reports that the version awaits approval, the package maintainer can inspect it in the npm **Staged Packages** tab or use an authenticated local CLI:

```sh
npm stage list @wieslawsoltes/richtextweb@0.5.0
npm stage view <stage-id>
npm stage download <stage-id>
# Compare the download against the existing release's SHA256SUMS.txt first.
npm stage approve <stage-id>
```

Approval is a human, two-factor-authenticated operation. Do not place one-time passwords in repository secrets, change account security settings, reject a staged artifact merely to retry, or increment the package version just to evade this gate. After approval, rerun the read-only verification workflow.

Reference: https://docs.npmjs.com/staged-publishing/ and https://docs.npmjs.com/cli/v11/commands/npm-stage/. The original 0.5.0 GitHub release and deployed sample are independent of this registry availability check.
