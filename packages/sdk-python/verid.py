"""
Verid Python SDK. One file, standard library only (Python 3.8+).

Record what an AI agent does, have the result validated on a server, and publish a verifiable receipt on Arc.

    # curl -O https://YOUR-HOST/sdk/verid.py
    from verid import Verid

    verid = Verid.from_env()            # VERID_API_KEY + VERID_URL

    def work(run):
        hits = run.tool("search", {"q": "AI startups"}, lambda i: my_search(i["q"]))   # recorded as evidence
        return [{"name": h["title"], "url": h["url"]} for h in hits]                   # the result to validate

    out = verid.run(
        agent="my-agent",
        task={"description": "Find 5 AI startups", "parameters": {"minimumResults": 5}},
        validator={"slug": "startup-list", "name": "Startup list", "rules": [
            {"type": "items", "path": "$", "min": {"param": "minimumResults"}},
            {"type": "required_fields", "path": "$[*]", "fields": ["name", "url"]},
            {"type": "evidence", "types": ["tool_call", "tool_result"]},
        ]},
        fn=work,
    )
    out.status      # "pass" | "fail" | "inconclusive", decided by the Verid server, not your code
    out.anchored    # True once the receipt is confirmed on Arc
    out.proof_url   # public, no-login proof page

If your function raises, the run is recorded as FAILED (with the reason) and the exception is re-raised. A failed
validation is preserved and can never be anchored or paid out. Retries reuse one idempotency key, so they never duplicate.
"""
import json
import os
import re
import socket
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

__all__ = ["Verid", "VeridError", "VeridNetworkError", "RunOutcome"]
__version__ = "0.1.0"

_RETRY = {429, 502, 503, 504}
_KEY_RE = re.compile(r"^verid_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}$")
_MAX_EVIDENCE = 200_000


class VeridError(Exception):
    """A non-2xx answer from Verid. `.code` is the stable error code (see the API docs)."""

    def __init__(self, status: int, code: str, message: str, details: Any = None, request_id: Optional[str] = None):
        super().__init__(message)
        self.status, self.code, self.details, self.request_id = status, code, details, request_id

    @property
    def validation_errors(self) -> List[str]:
        d = self.details if isinstance(self.details, dict) else {}
        return [str(x) for x in d.get("errors", [])]


class VeridNetworkError(Exception):
    """Verid could not be reached on any attempt."""


@dataclass
class RunOutcome:
    result: Any
    execution_id: str
    receipt_id: str
    status: str
    validator_id: str
    validator_version: str
    checks: List[Dict[str, Any]]
    anchored: bool
    anchor: Optional[Dict[str, Any]]
    anchor_note: Optional[str]
    execution_url: str
    proof_url: str


def _fit(content: Any) -> Any:
    try:
        s = json.dumps(content)
    except (TypeError, ValueError):
        return {"unserialisable": True, "type": type(content).__name__}
    if len(s) <= _MAX_EVIDENCE:
        return content
    return {"truncated": True, "originalBytes": len(s), "preview": s[:50_000]}


class _Ctx:
    def __init__(self, verid: "Verid", execution_id: str, run_id: str):
        self._v, self.execution_id, self._run, self._n = verid, execution_id, run_id, 0

    def record(self, type: str, content: Any) -> None:
        """Record one piece of evidence (tool_call, tool_result, model_output, artifact). Do not record secrets."""
        self._v.executions.add_evidence(self.execution_id, type, _fit(content), f"{self._run}:ev:{self._n}")
        self._n += 1

    def tool(self, name: str, input: Any, fn: Callable[[Any], Any]) -> Any:
        """Run a tool call and record it: a tool_call before and a tool_result after (with the error if it raised)."""
        self.record("tool_call", {"tool": name, "input": input})
        try:
            out = fn(input)
        except Exception as e:  # recorded, then re-raised
            try:
                self.record("tool_result", {"tool": name, "error": str(e)})
            except Exception:
                pass
            raise
        self.record("tool_result", {"tool": name, "output": out})
        return out


class Verid:
    def __init__(self, api_key: str, base_url: str, timeout: float = 30.0, max_retries: int = 3):
        if not _KEY_RE.match(api_key or ""):
            raise ValueError("Verid: api_key is missing or malformed. Create one in the dashboard under Settings -> API Keys.")
        if not base_url:
            raise ValueError("Verid: base_url is required, e.g. https://your-verid-host.example")
        root = re.sub(r"/api/v1/?$", "", base_url.rstrip("/"))
        self.app_url, self.api_url = root, root + "/api/v1"
        self._key, self._timeout, self._retries = api_key, timeout, max_retries
        self.agents, self.validators = _Agents(self), _Validators(self)
        self.executions, self.validations, self.receipts = _Executions(self), _Validations(self), _Receipts(self)

    @classmethod
    def from_env(cls, env: Optional[Dict[str, str]] = None) -> "Verid":
        env = os.environ if env is None else env
        return cls(env.get("VERID_API_KEY", ""), env.get("VERID_URL", ""))

    def request(self, method: str, path: str, body: Any = None, idempotency_key: Optional[str] = None, allow: tuple = ()) -> Dict[str, Any]:
        # One idempotency key per LOGICAL call, reused across retries, so a retry can never duplicate.
        idem = idempotency_key or (None if method in ("GET", "DELETE") else uuid.uuid4().hex)
        last: Any = None
        for attempt in range(self._retries + 1):
            if attempt:
                time.sleep(min(8.0, 0.25 * 2 ** (attempt - 1)))
            headers = {"authorization": "Bearer " + self._key}
            data = None
            if body is not None:
                headers["content-type"], data = "application/json", json.dumps(body).encode()
            if idem:
                headers["idempotency-key"] = idem
            try:
                with urlopen(Request(self.api_url + path, data=data, method=method, headers=headers), timeout=self._timeout) as r:
                    status, raw, rid = r.status, r.read(), r.headers.get("x-request-id")
            except HTTPError as e:
                status, raw, rid = e.code, e.read(), e.headers.get("x-request-id")
                if status in _RETRY and attempt < self._retries:
                    ra = e.headers.get("retry-after")
                    if ra and ra.isdigit():
                        time.sleep(min(int(ra), 10))
                    last = f"HTTP {status}"
                    continue
            except (URLError, socket.timeout, ConnectionError) as e:
                last = e
                continue
            try:
                parsed = json.loads(raw) if raw else {}
            except ValueError:
                parsed = {}
            if not 200 <= status < 300 and status not in allow:
                err = parsed.get("error", {}) if isinstance(parsed, dict) else {}
                raise VeridError(status, err.get("code", "error"), err.get("message", f"Request failed ({status})"), err.get("details"), rid)
            parsed["_status"] = status
            return parsed
        raise VeridNetworkError(f"Could not reach Verid at {self.api_url} after {self._retries + 1} attempts: {last}")

    def execution_url(self, execution_id: str) -> str:
        return f"{self.app_url}/executions/{execution_id}"

    def run(self, *, agent: Any, task: Dict[str, Any], validator: Any, fn: Callable[[_Ctx], Any], anchor: bool = True, run_id: Optional[str] = None) -> RunOutcome:
        """Run `fn` as a recorded, validated, (optionally) anchored execution. See the module docstring."""
        run_id = run_id or uuid.uuid4().hex
        if isinstance(agent, str) and agent.startswith("agt_"):
            agent_id = agent
        else:
            agent_id = self.agents.ensure(**({"slug": agent} if isinstance(agent, str) else agent))["id"]
        validator_id = validator if isinstance(validator, str) else self.validators.ensure(**validator)

        ex = self.executions.create(agent_id, task, f"{run_id}:exec")
        try:
            self.executions.start(ex["id"])
        except VeridError as e:
            if e.code != "invalid_state":
                raise  # otherwise: already started, we are resuming
        self.executions.add_evidence(ex["id"], "task", task, f"{run_id}:task")

        ctx = _Ctx(self, ex["id"], run_id)
        try:
            result = fn(ctx)
        except BaseException as e:
            try:
                self.executions.fail(ex["id"], str(e)[:500])
            except Exception:
                pass  # best effort; the original error matters more
            raise

        self.executions.complete(ex["id"], result, f"{run_id}:complete")
        v = self.validations.run(ex["id"], validator_id, f"{run_id}:validate")["validation"]
        receipt = self.receipts.create(ex["id"])

        anchored, anch, note = False, None, None
        if v["status"] != "pass":
            note = f"validation {v['status']}: a failed run is preserved but can never be anchored or paid out"
        elif not anchor:
            note = "anchoring was turned off for this run"
        else:
            try:
                a = self.receipts.anchor(receipt["receiptId"])
                anchored, anch = a["confirmed"], a["anchor"]
                if not anchored:
                    note = "the anchor transaction is pending; call verid.receipts.anchor(receipt_id) again" if a["pending"] else "not confirmed"
            except VeridError as e:
                note = "this Verid server has no chain configured, or it is unreachable" if e.code == "unavailable" else str(e)
        return RunOutcome(result, ex["id"], receipt["receiptId"], v["status"], v["validatorId"], v["validatorVersion"], v["checks"],
                          anchored, anch, note, self.execution_url(ex["id"]), self.receipts.proof_url(receipt["receiptId"]))


class _Agents:
    def __init__(self, v: Verid):
        self._v = v

    def create(self, name: str, version: str, slug: Optional[str] = None, description: Optional[str] = None, capabilities: Optional[List[str]] = None) -> Dict[str, Any]:
        body = {k: x for k, x in {"slug": slug, "name": name, "version": version, "description": description, "capabilities": capabilities}.items() if x is not None}
        return self._v.request("POST", "/agents", body)["agent"]

    def list(self) -> List[Dict[str, Any]]:
        return self._v.request("GET", "/agents?limit=100")["data"]

    def get(self, id: str) -> Dict[str, Any]:
        return self._v.request("GET", f"/agents/{id}")["agent"]

    def ensure(self, slug: str, name: Optional[str] = None, version: str = "1.0.0", description: Optional[str] = None, capabilities: Optional[List[str]] = None) -> Dict[str, Any]:
        try:
            return self.create(name or slug, version, slug, description, capabilities)
        except VeridError as e:
            if e.status != 409:
                raise
            found = next((a for a in self.list() if a["slug"] == slug), None)
            if not found:
                raise
            return found

    def update(self, id: str, **patch: Any) -> Dict[str, Any]:
        return self._v.request("PATCH", f"/agents/{id}", patch)["agent"]

    def delete(self, id: str) -> None:
        self._v.request("DELETE", f"/agents/{id}")


class _Validators:
    def __init__(self, v: Verid):
        self._v = v

    def list(self) -> List[Dict[str, Any]]:
        return self._v.request("GET", "/validators")["data"]

    def create(self, slug: str, name: str, rules: List[Any], description: str = "") -> Dict[str, Any]:
        return self._v.request("POST", "/validators", {"slug": slug, "name": name, "description": description, "rules": rules})["validator"]

    def ensure(self, slug: str, name: str, rules: List[Any], description: str = "") -> str:
        """Make the server's validator match the rules in your code. Safe to call on every run.

        New slug -> creates version 1. These exact rules already exist -> creates nothing. You changed the rules ->
        creates version N+1. Returns the id to validate with, pinned to the matching version ("custom:<slug>@<n>"), so a
        deployment still running older rules keeps using them. Only the rules count: renaming does not create a version.
        """
        r = self._v.request("POST", "/validators/ensure", {"slug": slug, "name": name, "description": description, "rules": rules})
        return f"custom:{slug}@{r['validator']['version']}"

    def update(self, slug: str, **patch: Any) -> Dict[str, Any]:
        return self._v.request("PATCH", f"/validators/{slug}", patch)["validator"]

    def test(self, rules: List[Any], result: Any, evidence_types: Optional[List[str]] = None, task_parameters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        body: Dict[str, Any] = {"rules": rules, "result": result}
        if evidence_types is not None:
            body["evidenceTypes"] = evidence_types
        if task_parameters is not None:
            body["taskParameters"] = task_parameters
        return self._v.request("POST", "/validators/test", body)


class _Executions:
    def __init__(self, v: Verid):
        self._v = v

    def create(self, agent_id: str, task: Dict[str, Any], idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        return self._v.request("POST", "/executions", {"agentId": agent_id, "task": task}, idempotency_key)["execution"]

    def start(self, id: str) -> Dict[str, Any]:
        return self._v.request("POST", f"/executions/{id}/start")["execution"]

    def add_evidence(self, id: str, type: str, content: Any, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        return self._v.request("POST", f"/executions/{id}/evidence", {"type": type, "content": content}, idempotency_key)["evidence"]

    def complete(self, id: str, result: Any, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        return self._v.request("POST", f"/executions/{id}/complete", {"result": result}, idempotency_key)["execution"]

    def fail(self, id: str, reason: str) -> Dict[str, Any]:
        return self._v.request("POST", f"/executions/{id}/fail", {"reason": reason})["execution"]

    def get(self, id: str) -> Dict[str, Any]:
        return self._v.request("GET", f"/executions/{id}")["execution"]


class _Validations:
    def __init__(self, v: Verid):
        self._v = v

    def run(self, execution_id: str, validator_id: str, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        return self._v.request("POST", "/validations", {"executionId": execution_id, "validatorId": validator_id}, idempotency_key)


class _Receipts:
    def __init__(self, v: Verid):
        self._v = v

    def create(self, execution_id: str) -> Dict[str, Any]:
        return self._v.request("POST", "/receipts", {"executionId": execution_id})["receipt"]

    def anchor(self, receipt_id: str) -> Dict[str, Any]:
        r = self._v.request("POST", f"/receipts/{receipt_id}/anchor", allow=(202,))
        a = r.get("anchor")
        return {"confirmed": bool(a and a.get("status") == "confirmed"), "anchor": a, "pending": r.get("_status") == 202}

    def proof_url(self, receipt_id: str) -> str:
        return f"{self._v.app_url}/proof/{receipt_id}"
