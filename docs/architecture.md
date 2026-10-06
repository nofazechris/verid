# VERID architecture and trust model

This document states precisely what VERID proves, what it does not, and how each
commitment is computed. It is the reference for anyone writing an independent
verifier. If code and this document disagree, that is a bug — please open an issue.

## 1. What a verified receipt does and does not prove

| Claim | Established by | Not established |
|---|---|---|
| The receipt has not been altered since commitment | `receiptHash` recomputation | That the original claims were true |
| Evidence supplied now equals evidence committed then | evidence root recomputation | That a tool call really occurred, or that an external API was honest |
| The result supplied equals the committed result | result hash recomputation | That the result is factually correct |
| A named validator recorded outcome X with result hash H | validation record hash + (optional) on-chain `VeridValidation` record | That the validator is independent, unbiased or correct |
| These commitments were published on-chain by an authorized anchorer | tx + registry state read directly from the chain | Anything about the real world |
| Settlement was released | on-chain escrow events (when the escrow ships) | Legal acceptance or work quality |

**Integrity verification is not factual verification.** A hash proves data matches
a previously committed value. VERID never claims more. Every validator result must
disclose what it did not check (see `ResearchValidator`'s `factual_claims_unverified`
check).

### Disclosed trust dependencies

1. **Anchorers.** `VeridRegistry` accepts writes only from an owner-managed allowlist
   (otherwise anyone could squat a guessable execution key with bogus commitments).
   Verifiers should read the record's `anchorer` field. The registry owner is a trust
   dependency; use a multisig and the two-step ownership transfer built into the contract.
2. **Validators.** `VeridValidation` records claims by owner-registered validator
   addresses. Anything consuming `isPass` (e.g. an escrow) inherits that trust.
3. **Agent-supplied evidence is untrusted** until independently checked. The evidence
   root only proves evidence was not changed after commitment.
4. **RPC.** The CLI trusts the RPC endpoint you give it for chain facts. Use your own
   node or several providers for high-stakes verification.

## 2. Canonicalization (`@verid/core` `canonicalize`)

Structure follows RFC 8785 (JCS): no insignificant whitespace; object keys sorted by
UTF-16 code unit order; numbers via the ECMAScript number→string algorithm; strings
escaped as `JSON.stringify`. Unlike `JSON.stringify` it is **strict**: `undefined`,
functions, symbols, `bigint`, `NaN`, `±Infinity`, `-0`, non-plain objects (`Date`, `Map`,
class instances) and cycles throw instead of being silently coerced. Convert such values
explicitly (e.g. `bigint` → decimal string).

*Limitation:* other-language implementations must reproduce the ES number algorithm
exactly. Prefer strings for high-precision numerics.

## 3. Commitments

All commitments are `keccak256` (EVM-native, 32 bytes, `0x` + 64 lowercase hex) and are
**domain-separated**:

```
commit(domain, value) = keccak256( utf8(domain) || 0x00 || utf8(canonical(value)) )
```

| Object | Domain tag |
|---|---|
| Task | `VERID/task/v1` |
| Policy | `VERID/policy/v1` |
| Evidence content | `VERID/evidence-content/v1` |
| Result | `VERID/result/v1` |
| Validation result | `VERID/validation/v1` |
| Receipt | `VERID/receipt/v1` |
| Execution key | `VERID/execution-id/v1` |

Because of the tag, a task hash can never equal a policy hash for any input. Changing a
tag is a breaking change to the scheme.

**Execution key** (the on-chain lookup key) = `keccak256(utf8("VERID/execution-id/v1") || 0x00 || utf8(executionId))`.

## 4. Evidence root

Each record commits `{contentHash, executionId, sequenceNumber, timestamp, type}`:

```
leaf  = keccak256(0x00 || canonical({contentHash, executionId, sequenceNumber, timestamp, type}))
node  = keccak256(0x01 || left || right)
tree  = binary Merkle tree over leaves ordered by sequenceNumber (odd node promoted, never duplicated)
root  = keccak256(0x02 || uint64_be(count) || treeRoot)        (treeRoot = 32 zero bytes if empty)
```

Design properties:

* Leaf (`0x00`) and node (`0x01`) prefixes prevent leaf/node second-preimage confusion.
* Promoting (not duplicating) an odd node avoids the duplicate-leaf ambiguity of naive trees.
* The `count` is bound into the root, so a prefix of the evidence never shares a root with the full set.
* Sequence numbers must be exactly `0..n-1` for a single execution; gaps, duplicates and
  mixed executions raise an error — an incomplete set can never produce a root.

**What it does not bind:** `metadata`, `contentReference` and `id` are *not* committed.
They are unauthenticated, supplementary data and must not be trusted for security decisions.
Raw evidence content is stored off-chain; only hashes are ever published.

## 5. Receipt (schema v1.0)

*Committed* (bound by `receiptHash`; mirrored in the on-chain record): `schemaVersion`,
`executionId`, `agent.{id,version}`, `task.hash`, `policy.hash` (or none), `evidence.{root,count}`,
`result.hash`, `validation.{status,validatorId,validatorVersion,resultHash}`.

*Supplementary* (not committed): `receiptId`, `timestamps`, `anchor`, `settlement`.
`anchor` cannot be committed — it is the output of anchoring the commitment.
Absent policy and present policy are different commitments. The schema is strict:
unknown fields are rejected.

## 6. Verification (`verifyReceipt`)

Returns a structured report of explicit checks — never a trust score:

`VALID` · `INVALID` · `NOT_CHECKED` · `UNAVAILABLE` · `PENDING` · `CONFIRMED` · `MATCH`

Rules the engine enforces:

* A check is `VALID` only if something was actually recomputed and compared.
* Missing input is `NOT_CHECKED`, never `VALID`. An unreachable RPC is `UNAVAILABLE`.
* Outcome is `verified` only when **every** check is OK; otherwise `incomplete`, or
  `invalid` if any check failed.
* A plausible transaction hash is not accepted on its own: the on-chain record read from
  the registry must equal the receipt's commitments, and the transaction must target the
  configured registry on the configured chain.

CLI exit codes: `0` verified · `1` invalid · `2` incomplete · `64` usage · `66` unreadable input.

## 7. Execution lifecycle

```
created → running → evidence_captured → awaiting_validation → validated → anchoring → anchored → settling → settled
                                                           ↘ validation_failed (terminal, preserved)
anchoring → validated   (reverted/dropped anchor tx; safe to retry — anchoring is idempotent)
any non-terminal → failed
```

A failed validation is terminal: retrying means a **new** execution with its own receipt,
and the failure is never overwritten. Settlement is reachable only from `anchored`, which is
reachable only via `validated`, so a failed validation can never settle.

## 8. Contracts

* **`VeridRegistry`** — append-only; one record per execution key; duplicate and
  conflicting writes revert; no update/delete path; allowlisted anchorers; two-step
  ownership; `renounceOwnership` disabled. Absent records are returned as a zeroed struct
  (`validationStatus == None`) so clients can tell "no record" from "call failed".
* **`VeridValidation`** — write-once validation records by registered validators.
  Revoking a validator affects only future records. An outcome can never change.
* **`VeridEscrow`** — holds an ERC-20 (USDC on Arc, 6 decimals) per execution key. `release`
  (callable by anyone, pays only the payee) requires **both** an on-chain `VeridValidation`
  `Pass` record and a `VeridRegistry` anchor whose status is `Pass`; never a caller-supplied
  flag. `refund` (anyone, pays only the payer) requires a recorded `Fail`, or an expired
  deadline without the release conditions met (this includes `Inconclusive`, and "validated but
  never anchored"). Once the release conditions hold, refund is impossible even after the
  deadline. No owner, admin, pause, fee or upgrade path; no unilateral payer cancel; fee-on-transfer
  tokens are rejected. It inherits the validator/anchorer trust of the two contracts it reads.
  **Backend/dashboard flow:** the payer's own wallet does `approve` + `create` (the dashboard
  offers this via a browser wallet; Verid never holds payer keys). `POST /executions/:id/settlement`
  links the escrow by READING payer/payee/amount/deadline from the chain, never from the client.
  `POST /executions/:id/settle` first writes the validation outcome to `VeridValidation` (idempotent,
  signed by a registered validator key, ideally different from the anchorer key), then asks the
  contract whether release/refund is allowed and triggers it; the relayer only pays gas. Execution
  state moves `anchored → settling → settled` only after the chain confirms; a refund leaves the
  execution (and a failed validation) unchanged. Configure with `VERID_VALIDATION_ADDRESS`,
  `VERID_VALIDATOR_PRIVATE_KEY`, `VERID_ESCROW_ADDRESS`; absent => settlement reports `unavailable`.

## 9. Arc specifics (verified against docs.arc.io, 2026-10-01 — re-verify before deploying)

* Mainnet chain ID `5042`; RPC `https://rpc.mainnet.arc.io`; explorer `https://explorer.arc.io`.
* USDC ERC-20 interface `0x3600000000000000000000000000000000000000`, **6 decimals**; the native
  gas token is USDC with **18 decimals**. Never mix them when recording balances.
* **Minimum base fee 20 gwei; under-priced transactions are silently dropped.** `@verid/arc`
  clamps `maxFeePerGas` up to 20 gwei and `trackTransaction` reports long-unknown
  transactions as `dropped` (safe to resubmit — anchoring is idempotent).
* Deterministic finality: one confirmation is sufficient.
* Stock Foundry `anvil` is a standard EVM, not Arc. Local integration tests here validate our
  logic against a real EVM; they are not proof of Arc-specific behavior.
* The explorer URL scheme is **not documented**; `explorerTxUrl` assumes `/tx/<hash>` and
  must be verified before linking users to it.

## 10. Privacy

Only commitments, identifiers and the minimum verification metadata go on-chain. Never
publish raw prompts, credentials, personal data, private records or full API responses.
Validators make no network requests (no SSRF surface).
