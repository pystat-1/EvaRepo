# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## What is signed

The Windows releases of **Eva Desktop** published on this repository's [Releases page](https://github.com/pystat-1/EvaRepo/releases):

- the application (`eva-desktop.exe`, product name "Eva");
- its installer (`Eva_<version>_x64-setup.exe`).

Every signed file is built from the source code in this repository by the
[release workflow](../.github/workflows/desktop.yml) on GitHub-hosted runners,
started by a version tag (`desktop-v<version>`). Nothing built elsewhere is
submitted for signing. Each signing request is approved by hand before the
release is published.

## Team roles

| Role | Members |
|---|---|
| Authors (commit access) | [@pystat-1](https://github.com/pystat-1) |
| Reviewers (review contributions from people without commit access) | [@pystat-1](https://github.com/pystat-1) |
| Approvers (approve each signing request) | [@pystat-1](https://github.com/pystat-1) |

All members use multi-factor authentication for GitHub and SignPath.

## Privacy

See the [privacy statement](PRIVACY.md). In short: Eva Desktop keeps its data
on the computer it runs on. It only exchanges data with a sync server whose
address and key the user enters, and it checks this repository's Releases for
updates without sending any user data.
