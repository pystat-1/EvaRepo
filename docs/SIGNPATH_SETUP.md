# Setting up Windows code signing (SignPath Foundation)

Why: Windows (Smart App Control / SmartScreen) blocks or warns about apps
without a code-signing certificate. SignPath Foundation signs open-source
projects for free. The repository side is ready: MIT licence, the
[code signing policy](CODE_SIGNING_POLICY.md), the [privacy statement](PRIVACY.md),
product name and version in the files, and a release workflow that signs
the app and then the installer when the settings below exist.

## 1. Before applying

- Turn on two-factor authentication on the GitHub account (github.com →
  Settings → Password and authentication). SignPath requires it for everyone
  in the team.

## 2. Apply

At <https://signpath.org> choose **Apply** and give:

| Question | Answer |
|---|---|
| Project name | Eva |
| Repository | https://github.com/pystat-1/EvaRepo |
| Licence | MIT |
| What it does | Windows desktop app for a nursing college's clinical training: students, rotation schedule, evaluators and daily grades, stored locally; plus a phone app for evaluators. |
| Releases | https://github.com/pystat-1/EvaRepo/releases (Eva 0.2.0) |
| Code signing policy | https://github.com/pystat-1/EvaRepo/blob/main/docs/CODE_SIGNING_POLICY.md |
| Build system | GitHub Actions, GitHub-hosted runners (`.github/workflows/desktop.yml`) |
| Files to sign | `eva-desktop.exe` and the NSIS installer `Eva_<version>_x64-setup.exe` |

They review the project; approval can take days to a few weeks.

## 3. After approval, in SignPath

1. Your organisation and a project for this repository exist (SignPath
   Foundation creates or explains them). Note the **organisation ID**, the
   **project slug** and the **signing policy slug** (usually `release-signing`).
2. Link the project to the predefined trusted build system **GitHub.com** and
   install the SignPath GitHub App on this repository, as their guide asks.
3. Create two **artifact configurations** in the project, with exactly these
   slugs and contents:

   Slug `app`:

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="eva-desktop.exe" product-name="Eva">
         <authenticode-sign />
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

   Slug `installer`:

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="Eva_*_x64-setup.exe" product-name="Eva">
         <authenticode-sign />
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

4. Create an **API token** for a CI user that may submit signing requests.

## 4. In GitHub (Settings → Secrets and variables → Actions)

| Kind | Name | Value |
|---|---|---|
| Secret | `SIGNPATH_API_TOKEN` | the API token |
| Variable | `SIGNPATH_ORGANIZATION_ID` | the organisation ID |
| Variable | `SIGNPATH_PROJECT_SLUG` | the project slug |
| Variable | `SIGNPATH_POLICY_SLUG` | the signing policy slug |

From the next release tag on, the workflow signs the app, builds the
installer around it, signs the installer, and makes the update signature over
the signed installer. Each signing request waits (up to 2 hours) for you to
approve it in SignPath; approve both the `app` and the `installer` request.

Until these exist, releases are built exactly as before (unsigned for
Windows, still signed for Eva's own updates).
