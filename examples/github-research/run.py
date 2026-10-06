#!/usr/bin/env python3
"""
The same REAL agent run as run.mjs, in Python. Nothing is mocked.

The agent calls GitHub's public search API, every call and answer is sent to Verid as evidence, a rule-based
validator (defined by this script) checks the result, and a passing run is anchored on your configured chain.

    VERID_URL=http://localhost:3000/api/v1 VERID_API_KEY=verid_xxxxxxxx_... python run.py [topic] [minimumResults]
    python run.py rust-lang 8 --simulate-bad-result      # see a validation FAIL

Needs: Python 3.8+ only (standard library; nothing to install).
"""
import json, os, sys, time, uuid
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = os.environ.get("VERID_URL", "").rstrip("/")
KEY = os.environ.get("VERID_API_KEY")
args = [a for a in sys.argv[1:] if not a.startswith("--")]
SIMULATE_BAD = "--simulate-bad-result" in sys.argv
TOPIC = args[0] if args else "ai-agents"
MIN_RESULTS = int(args[1]) if len(args) > 1 else 5
CREATED_AFTER_YEAR = 2023

if not BASE or not KEY:
    sys.exit("Set VERID_URL (e.g. http://localhost:3000/api/v1) and VERID_API_KEY (Settings -> API Keys in the dashboard).")
APP = BASE[: -len("/api/v1")] if BASE.endswith("/api/v1") else BASE


class VeridError(Exception):
    def __init__(self, status, message, details=None):
        super().__init__(message)
        self.status, self.details = status, details


def http(method, url, body=None, headers=None, timeout=60):
    """Tiny standard-library HTTP helper: returns (status, parsed JSON or {})."""
    h = dict(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["content-type"] = "application/json"
    try:
        with urlopen(Request(url, data=data, method=method, headers=h), timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except HTTPError as e:  # non-2xx still has a JSON body we want to read
        raw = e.read()
        try:
            return e.code, (json.loads(raw) if raw else {})
        except ValueError:
            return e.code, {}
    except URLError as e:
        sys.exit(f"Network error calling {url}: {e.reason}")


def verid(method, path, body=None, idem=None):
    headers = {"authorization": "Bearer " + KEY}
    if idem:
        headers["idempotency-key"] = idem
    status, data = http(method, BASE + path, body, headers)
    if not 200 <= status < 300:
        e = data.get("error", {})
        raise VeridError(status, f"{method} {path} -> {status} {e.get('code', '')}: {e.get('message', 'request failed')}", e.get("details"))
    return data


# Rules as data: "what does a good result look like?" Evaluated by Verid on its server.
VALIDATOR_ID = "github-repo-list"
RULES = [
    {"type": "items", "path": "$", "min": {"param": "minimumResults", "default": 3}},
    {"type": "required_fields", "path": "$[*]", "fields": ["name", "url", "stars", "createdAt", "createdYear"]},
    {"type": "field_format", "path": "$[*].url", "format": "http_url"},
    {"type": "field_format", "path": "$[*].createdAt", "format": "iso_date"},
    {"type": "number_range", "path": "$[*].stars", "min": 0, "integer": True},
    {"type": "number_range", "path": "$[*].createdYear", "min": {"param": "createdAfterYear"}, "integer": True},
    {"type": "unique", "path": "$[*].url"},
    {"type": "evidence", "types": ["task", "tool_call", "tool_result", "result"]},
]


def step(n, msg):
    print(f"\n{n}. {msg}")


def main():
    step(1, "Make sure the validator and the agent exist in Verid")
    try:
        verid("POST", "/validators", {"slug": VALIDATOR_ID, "name": "GitHub repository list checker", "description": "A list of repositories with name, URL, stars and creation date, no duplicates.", "rules": RULES})
        print(f"   created validator custom:{VALIDATOR_ID} (version 1)")
    except VeridError as e:
        if e.status != 409:
            raise
        print(f"   validator custom:{VALIDATOR_ID} already exists, reusing it")
    try:
        agent = verid("POST", "/agents", {"slug": "github-researcher", "name": "GitHub Researcher", "version": "1.0.0", "capabilities": ["http.fetch", "github.search"], "description": "Finds popular GitHub repositories for a topic."})["agent"]
    except VeridError as e:
        if e.status != 409:
            raise
        agent = next(a for a in verid("GET", "/agents?limit=100")["data"] if a["slug"] == "github-researcher")
    print(f"   agent {agent['name']} ({agent['id']})")

    run = f"{int(time.time()):x}{uuid.uuid4().hex[:4]}"  # one run id drives every idempotency key: retries never duplicate
    task = {
        "description": f'Find {MIN_RESULTS} popular GitHub repositories for the topic "{TOPIC}" created in {CREATED_AFTER_YEAR} or later.',
        "parameters": {"topic": TOPIC, "minimumResults": MIN_RESULTS, "createdAfterYear": CREATED_AFTER_YEAR},
    }

    step(2, "Tell Verid a job is starting")
    ex = verid("POST", "/executions", {"agentId": agent["id"], "task": task}, f"exec-{run}")["execution"]
    verid("POST", f"/executions/{ex['id']}/start")
    verid("POST", f"/executions/{ex['id']}/evidence", {"type": "task", "content": task}, f"{run}-task")
    print(f"   execution {ex['id']}")

    step(3, "Do the real work, recording each call as evidence")
    q = f"topic:{TOPIC} created:>={CREATED_AFTER_YEAR}-01-01"
    url = f"https://api.github.com/search/repositories?q={quote(q)}&sort=stars&order=desc&per_page={max(MIN_RESULTS, 5)}"
    verid("POST", f"/executions/{ex['id']}/evidence", {"type": "tool_call", "content": {"tool": "github.search_repositories", "method": "GET", "url": url}}, f"{run}-call")
    headers = {"accept": "application/vnd.github+json", "user-agent": "verid-example"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    gh_status, body = http("GET", url, headers=headers, timeout=30)
    if gh_status != 200:
        sys.exit(f"GitHub said {gh_status}: {body.get('message', 'error')} (unauthenticated search is limited to 10 requests/minute)")
    hits = [{"full_name": r["full_name"], "html_url": r["html_url"], "stargazers_count": r["stargazers_count"], "created_at": r["created_at"]} for r in body["items"]]
    verid("POST", f"/executions/{ex['id']}/evidence", {"type": "tool_result", "content": {"status": gh_status, "total_count": body["total_count"], "items": hits}}, f"{run}-result")
    print(f"   GitHub returned {len(hits)} repositories (of {body['total_count']} matches)")

    result = [{"name": r["full_name"], "url": r["html_url"], "stars": r["stargazers_count"], "createdAt": r["created_at"], "createdYear": datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")).year} for r in hits]
    if SIMULATE_BAD:
        result[0] = {**result[0], "url": "not-a-url"}
        print("   (--simulate-bad-result: the first entry now has an invalid URL)")

    step(4, "Hand Verid the result and let it validate")
    verid("POST", f"/executions/{ex['id']}/complete", {"result": result}, f"{run}-done")
    v = verid("POST", "/validations", {"executionId": ex["id"], "validatorId": f"custom:{VALIDATOR_ID}"}, f"{run}-validate")
    val = v["validation"]
    print(f"   outcome: {val['status'].upper()}  (validator {val['validatorId']} @ {val['validatorVersion']})")
    for c in val["checks"]:
        mark = "·" if not c["determinate"] else ("✓" if c["ok"] else "✕")
        print(f"   {mark} {c['description']}" + ("" if c["ok"] else f"\n       {c.get('explanation')}"))

    step(5, "Create the receipt")
    receipt = verid("POST", "/receipts", {"executionId": ex["id"]})["receipt"]
    print(f"   receipt {receipt['receiptId']}")

    if val["status"] != "pass":
        print(f"\nThe validation did not pass, so this run is recorded as {v['executionStatus']} and can never be anchored or paid out.")
        print("The failure is preserved exactly as it happened. Run the script again for a new execution.")
        print(f"See it: {APP}/executions/{ex['id']}")
        return

    step(6, "Anchor the receipt's fingerprints on the chain")
    try:
        a = verid("POST", f"/receipts/{receipt['receiptId']}/anchor")["anchor"]
        print(f"   {a['status']}" + (f"  tx {a['transactionHash']}" if a.get("transactionHash") else ""))
    except VeridError as e:
        print(f"   not anchored: {e}\n   (Anchoring needs a chain configured on the server. The run is still validated and has a receipt.)")

    print("\nDone. Look at it:")
    print(f"  Dashboard : {APP}/executions/{ex['id']}")
    print(f"  Public proof (shareable, no login): {APP}/proof/{receipt['receiptId']}")


if __name__ == "__main__":
    try:
        main()
    except VeridError as e:
        print(f"\nFailed: {e}")
        for x in (e.details or {}).get("errors", []):
            print(f"  - {x}")
        sys.exit(1)
