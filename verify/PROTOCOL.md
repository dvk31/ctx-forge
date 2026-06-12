# Verification Protocol

Version: `0.1` (pre-release; breaking changes allowed until `1.0`)

Agent-generated tooling has one existential risk: **the confident liar** — a tool that answers plausibly and wrong. This protocol is how ctx-forge earns the right to be trusted. No command is installed until it passes; no regen completes without re-passing.

The selftest runner is part of every generated toolset (invoked as `ctx selftest`), written in the project's own language, implementing this protocol. ctx-forge ships the protocol, not a binary — the rules below are the conformance target.

## 1. The core rule: independent ground truth

Ground truth for a golden question MUST be established **without using the tool under test** — by raw exploration: grep, file reads, the framework's own shell/console, running the test suite. The derivation method is recorded alongside the answer.

This is the whole trick. The generating agent is both toolsmith and auditor, so the audit must not depend on the work being audited. A golden question whose expected answer was produced by the tool itself is worthless and MUST NOT be recorded.

The protocol catches failures in **both directions**, and field use has produced one of each:

- **Tool bug**: a `flow` implementation scanned a whole 4,000-line view module instead of the single view node and attributed every service call to one route. The golden question failed; the fix is pinned forever by a `not_contains` matcher.
- **Question bug**: a question asserting `contains_line: "activate"` silently passed against output containing `/deactivate/` — the *question* was the liar. Treat golden questions as code: when one is found to over- or under-match, fix the matcher and record the post-mortem in its `derived_from` so the lesson travels with the question.

## 2. golden.yaml format

```yaml
version: "0.1"
questions:
  - id: schema-user-fields
    command: schema
    args: ["--find", "User", "--json"]
    derived_from: "read src/accounts/models.py:14-58 directly"
    expect:
      - matcher: json_subset
        value:
          model: "accounts.User"
          fields: { email: "EmailField", is_active: "BooleanField" }

  - id: api-webhook-route
    command: api
    args: ["--find", "webhook", "--locate"]
    derived_from: "grep -n 'webhook' config/urls.py + read handler"
    expect:
      - matcher: contains_line
        value: "src/billing/views.py"
      - matcher: anchor
        value: { path: "src/billing/views.py", symbol: "StripeWebhookView" }

  - id: flow-signal-dispatch        # adversarial: dynamic registration
    command: flow
    args: ["order placed"]
    derived_from: "traced OrderService.place -> signals.order_placed via runtime shell"
    expect:
      - matcher: contains_all
        value: ["order_placed", "OrderService.place", "notifications/handlers.py"]
      - matcher: not_contains       # guards against a known wrong answer
        value: "legacy/orders_v1.py"

  - id: impact-pricing-module
    command: impact
    args: ["src/billing/pricing.py"]
    dropped: true                    # kept for retry on next regen
    derived_from: "manual import-graph walk"
    expect:
      - matcher: contains_all
        value: ["src/billing/invoice.py", "tests/test_pricing.py"]
```

Field rules:

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Unique, stable, kebab-case. |
| `command` / `args` | yes | Exactly what `ctx selftest` executes. Args MUST include `--json` or `--locate` where exact matching needs structure. |
| `derived_from` | yes | One line: how ground truth was established. Auditable honesty, and a recipe for re-derivation when the question goes stale. |
| `expect` | yes | One or more matchers (§3). ALL must pass. |
| `dropped` | no | `true` = belongs to a dropped command; skipped by selftest, retried by regen. |

## 3. Matchers

| Matcher | Passes when |
|---------|-------------|
| `exact` | stdout equals `value` byte-for-byte (use sparingly; brittle). |
| `contains_line` | some output line contains `value` as a substring. |
| `contains_all` | every string in `value` appears somewhere in output. |
| `not_contains` | `value` appears nowhere in output. Use to pin known-wrong answers. |
| `regex` | `value` (multiline regex) matches output. |
| `json_subset` | output parses as JSON and `value` is a recursive subset of it (objects: all keys present and matching; arrays: every element of `value` present in output array). Requires `--json` in args. |
| `anchor` | the `path` exists in the working tree and contains `symbol` — re-resolved against the **current** tree, never against cached line numbers. The matcher that keeps anchors honest as code drifts. |

Matching is performed on stdout only, after stripping trailing whitespace per line. stderr is ignored (diagnostics live there by contract).

## 4. Coverage minimums

Per the tool contract (§6):

- 3 golden questions per installed core/standard command (`map`, `find`, `flow`, `schema`, `api`, `impact`).
- 1 per stack-specific command.
- `regen`, `selftest`, `help` are exercised implicitly and need no questions.

Quality mix — for each command, aim for:

1. **Easy**: the happy path a demo would show.
2. **Specific**: an answer with a precise fact (a field type, an exact route, a `file:line`) that a hand-wavy implementation would get wrong.
3. **Adversarial**: the places static analysis lies — dynamic dispatch, re-exported symbols, decorator-registered routes, settings-dependent wiring, name shadowing. Derive these from the audit's notes on the project's tricky spots. At least one `not_contains` matcher somewhere in the suite, pinning a plausible wrong answer.

## 5. Selftest mechanics

`ctx selftest` MUST:

1. Run every non-`dropped` question: execute `command` + `args`, apply all matchers.
2. Report per-question: `PASS` / `FAIL` with, on failure, the matcher that failed and a short diff (expected vs. relevant slice of actual).
3. Exit 0 if all pass; exit 3 if any fail. Never exit 0 with failures.
4. Update `[verify]` in `ctx.toml`: `last_selftest`, `last_selftest_result`, `questions`.
5. Verify conformance: every `[commands]` entry meets its coverage minimum; the declared conformance level's required commands exist. Shortfalls are failures.
6. Be deterministic and offline: no network, no LLM calls. (`ctx ask` is exempt from golden questions for this reason; verify it only by checking it fails gracefully without its API key.)

## 6. Lifecycle

**At generation (Phase 4 of the skill):** derive ground truth -> write questions -> run selftest -> one fix-and-retry cycle per failing command -> drop what still fails (`dropped: true` here, `[dropped]` in `ctx.toml`).

**At regen:** `ctx regen` rebuilds indexes, then re-runs selftest automatically. Questions referencing code that no longer exists are reported as `STALE-QUESTION` (distinct from `FAIL`): the regen flow re-derives them from `derived_from` or deletes them with the user's consent. A regen ending in failures restores the previous state or marks `last_selftest_result = "fail"` — never silently keeps broken tools.

This cycle is routine, not exceptional. Observed live: one upstream merge landed under a generated toolset -> staleness hash tripped (exit 2) -> `regen` rebuilt indexes -> three golden anchors had rotted (a view module shifted ~38 lines; the app count changed) -> each was re-derived from its `derived_from` recipe -> selftest green. Total cost: minutes. The `derived_from` field is what makes re-derivation mechanical instead of archaeological — write it for your future self.

**Retry of dropped commands:** each regen MAY retry `dropped` questions; a command that passes gets reinstated (move out of `[dropped]`, flip `dropped: false`).

## 7. What this protocol does not do

- It does not prove completeness — a tool can pass goldens and still miss things. Coverage minimums and adversarial mix shrink, not eliminate, that gap.
- It does not replace the user reviewing `.ctx/tools/` — generated tools are committed source precisely so humans can read them.
- It does not verify `ctx ask` answer quality (LLM-dependent, non-deterministic). The ask layer's trust model is different: it cites guides, and guides are generated by verified tools.
