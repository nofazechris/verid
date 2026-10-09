# Publishing the SDKs

Two packages, same version number, same name, `verid`:

| Registry | Package | Folder | Install |
|---|---|---|---|
| npm | `verid` | `packages/sdk` | `npm install verid` |
| PyPI | `verid` | `packages/sdk-python` | `pip install verid` |

Both were free on 9 October 2026 (checked against the registries). Publishing is done with **your** accounts: no token ever
needs to be shared or committed. A published version can never be replaced, only superseded, so do the dry runs first.

## Before either one

```bash
pnpm install --frozen-lockfile
pnpm --filter verid test          # the SDK tests
pnpm scan:secrets                 # nothing that looks like a key is in the repository
```

## npm (`verid`)

Account and organisation (one time): create an npm account, turn on two-factor authentication, and, if you want the
`veridsdk` organisation to own the package, create that organisation at https://www.npmjs.com/org/create.

```bash
cd packages/sdk
npm login                          # opens the browser
npm pack --dry-run                 # list what would be published: dist/, README.md, LICENSE, package.json only
npm publish --access public        # asks for your 2FA code; runs the build first (prepublishOnly)
```

Then check it from a clean folder:

```bash
mkdir /tmp/try && cd /tmp/try && npm init -y && npm install verid
node -e "import('verid').then(m => console.log(Object.keys(m)))"
```

If npm refuses the name `verid` as too similar to an existing package, publish under the organisation instead
(`@veridsdk/verid`): change `"name"` in `packages/sdk/package.json` and the two snippets that say `npm install verid` and
`from "verid"` (search for them), then publish the same way.

To give the organisation ownership of an unscoped package later: `npm owner add <user> verid`, or manage access in the
npm website under the package's Settings.

## PyPI (`verid`)

Account (one time): create accounts at https://test.pypi.org and https://pypi.org, turn on two-factor authentication, and
create an **API token** on each (scope it to the project after the first upload).

```bash
cd packages/sdk-python
python -m pip install --upgrade build twine
python -m build                    # creates dist/verid-0.1.1.tar.gz and dist/verid-0.1.1-py3-none-any.whl
python -m twine check dist/*

# Rehearse on TestPyPI first
python -m twine upload --repository testpypi dist/*
python -m pip install --index-url https://test.pypi.org/simple/ --no-deps verid

# The real one (username is __token__, password is your PyPI API token)
python -m twine upload dist/*
```

Delete `dist/`, `build/` and `*.egg-info/` afterwards; they are not committed.

## Releasing a new version

1. Change `version` in `packages/sdk/package.json` **and** `packages/sdk-python/pyproject.toml` (and `__version__` in
   `verid.py`). Keep them equal.
2. Run the tests, commit, tag (`git tag v0.1.1`), push.
3. Publish both as above.

## What the server also offers

Every Verid server serves the same SDK files for networks that cannot reach npm or PyPI:
`/sdk/verid-sdk.tgz` (`npm install ./verid-sdk.tgz` after downloading it) and `/sdk/verid.py`.
