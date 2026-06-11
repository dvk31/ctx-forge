# Recipe: Django

Status: v0.1 · Applies to Django 4.x–6.x · Distilled from a production suite of 30+ context commands run daily by agents on a large multi-tenant Django codebase.

A recipe is an accelerator for Phase 1–3 of the skill: the known-good introspection seams, canonical command names, implementation techniques, and the pitfalls that cost the original suite real debugging time. It does not override the contract or the protocol.

## 1. Boot strategy (read this first)

Django's killer advantage for ctx-forge: almost everything is reachable through **live registries** after `django.setup()` — runtime truth, not regex.

```python
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "<detected>")
django.setup()
```

Rules:

- Detect `DJANGO_SETTINGS_MODULE` from `manage.py` (it sets a default) or `pyproject.toml`. Split-settings projects (`settings/dev.py`, `settings/ci.py`) — prefer the dev/local module; ask the user if ambiguous.
- `django.setup()` does NOT need a reachable database. Model/URL/signal introspection is import-only. Never call anything that opens a connection (`Model.objects...`, `connection.introspection`) — tools must work with the DB down.
- Beware `AppConfig.ready()` side effects (thread starts, network registrations). If the project's `ready()` methods are unsafe, fall back to static analysis for the affected seam and record it in the command description.
- Boot once per process, cache to `.ctx/cache/` as JSON keyed by the surface hash. Cold boot is 1–3 s; warm reads must be instant (contract §3.7). Mark these commands `boots_framework = true` in `ctx.toml`.

## 2. Seams -> commands

| Contract command | Seam | Technique |
|---|---|---|
| `ctx schema` | `django.apps.apps.get_models()` | Walk `_meta`: `fields`, `related_objects`, `indexes`, `constraints`, `choices`, abstract bases/mixins. `inspect.getsourcefile/getsourcelines` on the model class gives the `file:line` anchor. |
| `ctx api` | `django.urls.get_resolver()` | Recursive walk of `url_patterns` (handle `URLResolver` vs `URLPattern`, namespaces, `include()`). For each pattern: route, name, callback -> unwrap `view_class` / `cls` (DRF) / `__wrapped__` (decorators) to the real function for anchors. DRF routers register dynamically — the resolver sees the final truth, which is exactly why runtime beats regex here. |
| `ctx flow` | URL resolver + service layer + signals, composed | Trace topic keyword through: matching route -> view -> calls into services (static call analysis of the view body via `ast`) -> signals sent (`Signal.send` call sites) -> receivers (registry, below). Cross-layer composition is the command's whole value; keep each hop anchored. |
| `ctx impact` | import graph + `ast` call sites | Static: build module import graph (stdlib `ast`, no deps), then symbol-level callers via name resolution. Honest about limits: dynamic dispatch (`getattr`, signals) is listed as "possible callers". Include affected tests (files importing the target). |
| `ctx find` | merged index | One index over models, views, URLs (by name), services, tasks, signals, settings keys. Each entry: kind, name, anchor. Substring + fuzzy match. |
| `ctx map` | `apps.get_app_configs()` + tree | Per-app: path, models count, views count, one-line responsibility (from app docstring/README if present). |

### Stack-specific commands (generate when present)

| Command | Seam | Notes |
|---|---|---|
| `ctx signals` | `Signal` instances + `_live_receivers` / `receivers` | Find all `django.dispatch.Signal` objects by scanning imported modules after setup; map sender -> receivers with anchors. Decorator-registered (`@receiver`) and `.connect()`-registered both appear — this is the seam regex always misses. |
| `ctx tasks` | Celery `app.tasks` registry | Import the Celery app; registry holds every task incl. dynamically registered. Anchor via the wrapped function. |
| `ctx middleware` | `settings.MIDDLEWARE` | Ordered pipeline with anchors; note request/response/exception hooks each class implements. |
| `ctx serializers` | DRF serializer classes via subclass walk | `rest_framework.serializers.Serializer.__subclasses__()` recursively, after forcing import of `*/serializers.py`. Map serializer -> model -> views using it. |
| `ctx admin` | `admin.site._registry` | Registered models, list_display, inlines. Low priority unless the project leans on admin. |
| `ctx settings` | `django.conf.settings` | Effective values for project-defined keys only (diff against `global_settings`), env-var provenance where derivable. NEVER print values of keys matching secret patterns (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `DSN`) — print the env var name instead. |

## 3. Surface globs (starting point)

```toml
[surface]
globs = [
  "**/models.py", "**/models/**.py",
  "**/urls.py", "**/views.py", "**/views/**.py",
  "**/serializers.py", "**/services.py", "**/services/**.py",
  "**/tasks.py", "**/signals.py", "**/receivers.py",
  "**/admin.py", "**/apps.py", "**/middleware.py",
  "<settings package>/**.py",
  "manage.py",
]
exclude = ["**/migrations/**", "**/tests/**", ".ctx/**", "**/__pycache__/**"]
```

Adjust to the project's actual layout during the audit (some projects put services in `domain/`, `core/`, etc. — follow the imports, not the convention).

## 4. Output patterns that earned their keep

From the original suite's daily agent use:

- `--find <pattern>` on every listing command; default output is the match list, not the whole inventory.
- `--locate` -> `path:line:name` lines, nothing else. Agents chain this into reads.
- `--edit-hints` on `api`/`schema`: after the answer, print the project's own pattern for adding one ("new endpoint: view in X, register in Y `urls.py`, serializer in Z, test in T") derived from how the last few were actually added (git log on the surface files is a fine source).
- Guides (`guides/schema.md`, `guides/api.md`) are regenerated wholesale from `--json` output. They exist for `ctx ask` retrieval and human onboarding; terminal commands stay the primary agent interface.
- A "Quick Decision Matrix" at the top of each guide ("need X? use model Y") outperforms exhaustive inventories for agent consumption. Generate it from heuristics (model size, FK centrality), keep it short.

## 5. Pitfalls (each one cost real time)

1. **System-app noise.** Exclude `django.contrib.*` and third-party apps from default output (keep behind `--all`). Agents need the project's surface, not Django's.
2. **`ready()` side effects.** See §1. Test `django.setup()` in a sandbox first; if it hangs or talks to the network, find the offending AppConfig and document the static fallback.
3. **Lazy objects.** `gettext_lazy` choices and `reverse_lazy` URLs break naive `str()`/JSON serialization. Force with `str()` inside a try, or render `repr`.
4. **Decorator unwrapping.** Views wrapped in `@login_required`, `@cache_page`, DRF `@api_view` hide the real function. Unwrap `__wrapped__` / `view_class` / `cls` chains until you hit something with a source file, else the anchor points at the decorator library.
5. **Abstract/inherited fields.** `_meta.fields` includes inherited fields whose `model` attribute is the parent. Anchor fields to their defining model, not the child — golden-question this (it is exactly where a sloppy implementation lies).
6. **Multiple settings modules.** The toolset is generated against ONE settings module; record it in `ctx.toml` `[project].entrypoint_hint`. Settings-dependent wiring (middleware, installed apps) may differ in prod — say so in `ctx settings` output.
7. **Monorepos.** Multiple `manage.py` = multiple toolsets (one `.ctx/` per Django app) or one umbrella with `--app` scoping. Ask the user (skill Phase 0).
8. **GenericForeignKey.** No real FK edge; `related_objects` won't show it. Detect `GenericForeignKey` fields explicitly and render them as dashed edges in relationship output.
9. **The project's pre-commit gate will lint `.ctx/`.** Django shops often run `ruff check .` in hooks/CI — the generated tools are in scope. Run the project's ruff config over `.ctx/` and fix before installing (observed: 16 violations blocked a commit on first dogfood — E501, UP038, E741).
10. **Stray system Pythons defeat naive venv detection.** A Homebrew Python with a global django made `import django` succeed outside the venv, then `ModuleNotFoundError: control_plane`. Require the project's full dependency set (e.g. django + DRF + one project-specific package) before trusting the interpreter; otherwise re-exec through `poetry run` (guard against re-exec loops with an env flag).
11. **No PyYAML in many lockfiles.** Write `golden.yaml` in JSON syntax (JSON is valid YAML) and parse with stdlib `json` — note the choice in the file header.

## 6. Golden questions to include (adversarial set)

Beyond the easy/specific ones, Django's lying-static-analysis spots:

- A `@receiver`-decorated handler in a module only imported via `AppConfig.ready()` — `ctx signals` must find it.
- A DRF router-registered route (`router.register(...)`) — `ctx api` must show the resolved path, which never appears literally in any file.
- An inherited field from an abstract base — `ctx schema` must anchor it to the base class file.
- A view wrapped in two decorators — `ctx api`'s anchor must point at the project's view, not at `functools` or DRF.
- `not_contains`: a model that exists only in `migrations/` history (deleted model) must NOT appear in `ctx schema`.

## 7. What not to build (v1)

The original suite grew 30+ commands; most projects need 8–12. Skip until asked: cache-key inventories, logging audits, hardcoded-value scans, feature-flag inventories, a11y/perf frontend audits. They are real but they are *audits*, not navigation — different cadence, different consumer. `[dropped]` and later regens exist precisely so the toolset can grow with demand.
