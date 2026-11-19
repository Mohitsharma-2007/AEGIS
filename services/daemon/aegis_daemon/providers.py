"""LLM provider layer: OpenAI-compatible providers configured via .env.

Env loading (no python-dotenv): a tiny .env parser. Search order for the
env file:
  1. ``AEGIS_ENV_FILE`` if set (only that file is used),
  2. ``daemon/.env.local`` (the daemon directory = parent of this package),
  3. ``aegis-unified/.env.local`` (the unified project root),
  4. ``aegis_project/.env.local`` (the parent project directory — where
     the keys actually live; the unified layout nests the daemon one
     level deeper than the original app layout, so this is the
     grandparent of the daemon directory, not its parent),
  5. ``./.env.local`` relative to the current working directory.
Values already present in ``os.environ`` take precedence over file values.

SECURITY: key values are never logged, printed, stored in the DB, or
returned in any API response. Status reporting exposes only the provider
NAME, the model, and whether a key is present (boolean).

Tier logic: ``AEGIS_NO_LLM=1`` forces offline. Otherwise, if the selected
provider (``AEGIS_PROVIDER``, default ``openrouter``) has a non-empty key,
the tier is ``cloud``; with no key the tier is ``offline``.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

# Per-provider defaults. Models are sensible free/default documented models
# and are all overridable via AEGIS_MODEL (global) — they are defaults, not
# a promise that a given account has access to them.
PROVIDER_DEFAULTS: dict[str, dict[str, str]] = {
    # The local model server (Ollama / LM Studio). It is a first-class provider
    # so that AEGIS_PROVIDER=local is actually honoured: without this entry the
    # selector silently fell back to "openrouter", which is how a local-only
    # install still reached a cloud API (and its 429 rate limit).
    "local": {
        "key_var": "AEGIS_LOCAL_API_KEY",
        "base_var": "AEGIS_LOCAL_BASE_URL",
        "default_base": "http://127.0.0.1:11434/v1",
        "default_model": "qwen3.5:0.8b",
    },
    # OpenRouter free-tier model (free variant of gpt-oss-20b).
    "openrouter": {
        "key_var": "OPENROUTER_API_KEY",
        "base_var": "OPENROUTER_BASE_URL",
        "default_base": "https://openrouter.ai/api/v1",
        "default_model": "openai/gpt-oss-20b:free",
    },
    "groq": {
        "key_var": "GROQ_API_KEY",
        "base_var": "GROQ_BASE_URL",
        "default_base": "https://api.groq.com/openai/v1",
        "default_model": "llama-3.3-70b-versatile",
    },
    "nvidia": {
        "key_var": "NVIDIA_API_KEY",
        "base_var": "NVIDIA_BASE_URL",
        "default_base": "https://integrate.api.nvidia.com/v1",
        "default_model": "meta/llama-3.3-70b-instruct",
    },
    # Conduit / TokenHarbor / Vercel expose OpenAI-compatible gateways; with
    # no provider-specific documented default we use a generic small model
    # name, overridable via AEGIS_MODEL.
    "conduit": {
        "key_var": "CONDUIT_API_KEY",
        "base_var": "CONDUIT_BASE_URL",
        "default_base": "https://conduit.ozdoev.net/v1",
        "default_model": "gpt-4o-mini",
    },
    "tokenharbor": {
        "key_var": "TOKENHARBOR_API_KEY",
        "base_var": "TOKENHARBOR_BASE_URL",
        "default_base": "https://tokenharbor.ai/v1",
        "default_model": "gpt-4o-mini",
    },
    "vercel": {
        "key_var": "VERCEL_AI_KEY",
        "base_var": "VERCEL_GATEWAY_URL",
        "default_base": "https://ai-gateway.vercel.sh/v1",
        "default_model": "gpt-4o-mini",
    },
}

PROVIDER_NAMES = list(PROVIDER_DEFAULTS.keys())


class ProviderError(Exception):
    """Typed provider failure. The message never contains a key value."""


def _app_dir() -> Path:
    return Path(__file__).resolve().parent.parent


def _env_file_candidates() -> list[Path]:
    explicit = os.environ.get("AEGIS_ENV_FILE")
    if explicit:
        return [Path(explicit).expanduser()]
    app_dir = _app_dir()
    return [
        app_dir / ".env.local",
        app_dir.parent / ".env.local",
        app_dir.parent.parent / ".env.local",
        Path.cwd() / ".env.local",
    ]


def find_env_file() -> Path | None:
    for candidate in _env_file_candidates():
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            continue
    return None


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return values
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


_FILE_VALUES: dict[str, str] | None = None
_ENV_FILE_USED: Path | None = None


def _file_values() -> dict[str, str]:
    global _FILE_VALUES, _ENV_FILE_USED
    if _FILE_VALUES is None:
        found = find_env_file()
        _ENV_FILE_USED = found
        _FILE_VALUES = _parse_env_file(found) if found else {}
    return _FILE_VALUES


def env_file_used() -> Path | None:
    _file_values()
    return _ENV_FILE_USED


def get_var(name: str, default: str = "") -> str:
    """Effective config value: real environment wins over the .env file."""
    if name in os.environ:
        return os.environ.get(name, default) or default
    return _file_values().get(name, default) or default


def no_llm() -> bool:
    return get_var("AEGIS_NO_LLM", "") == "1"


def selected_provider() -> str:
    name = (get_var("AEGIS_PROVIDER", "openrouter") or "openrouter").strip().lower()
    return name if name in PROVIDER_DEFAULTS else "openrouter"


def provider_config(name: str | None = None) -> dict:
    """Config for a provider. ``key`` is for internal use ONLY and must
    never be serialised into a response, log, or DB row."""
    pname = name or selected_provider()
    spec = PROVIDER_DEFAULTS[pname]
    key = get_var(spec["key_var"], "")
    # Local servers ignore the key, but OpenAI-compatible clients still send
    # one; never require an owner to invent a secret for their own machine.
    if pname == "local" and not key:
        key = "local"
    base = (get_var(spec["base_var"], "") or spec["default_base"]).rstrip("/")
    model = get_var("AEGIS_MODEL", "") or spec["default_model"]
    return {
        "provider": pname,
        "key": key,
        "key_present": bool(key),
        "base_url": base,
        "model": model,
    }


def llm_status() -> dict:
    """Public, secret-free LLM status for /health and /api/state."""
    cfg = provider_config()
    if no_llm():
        tier = "offline"
    elif cfg["provider"] == "local":
        # A local provider is never "cloud", whatever keys happen to exist in
        # the env file for other providers.
        tier = "local"
    elif cfg["key_present"]:
        tier = "cloud"
    else:
        tier = "offline"
    return {
        "tier": tier,
        "provider": cfg["provider"],
        "model": cfg["model"],
        "key_present": cfg["key_present"],
    }


def repo_root() -> Path:
    """AEGIS ONE repo root: two levels up from the daemon directory
    (daemon/aegis_daemon -> daemon -> repo root)."""
    return Path(__file__).resolve().parent.parent.parent


def configure_provider(name: str, api_key: str | None = None,
                       base_url: str | None = None,
                       activate: bool = False) -> dict:
    """Persist provider config from inside the app (Settings UI).

    Merges the given values into the resolved env file
    (``find_env_file()`` when one exists; the file named by
    ``AEGIS_ENV_FILE`` when that is set; otherwise a new
    ``<repo>/.env.local``), mirrors them into ``os.environ`` so the
    running daemon picks them up immediately, and returns
    ``llm_status()``. Only the provider's key/base vars (and
    ``AEGIS_PROVIDER`` when activating) are written — nothing else in
    the env file is touched. Key values are never returned or logged.
    """
    pname = (name or "").strip().lower()
    if pname not in PROVIDER_DEFAULTS:
        raise ValueError(
            f"unknown_provider:{pname}; valid providers: "
            f"{', '.join(PROVIDER_NAMES)}")
    spec = PROVIDER_DEFAULTS[pname]
    updates: dict[str, str] = {}
    if api_key is not None:
        updates[spec["key_var"]] = str(api_key)
    if base_url is not None:
        updates[spec["base_var"]] = str(base_url)
    if activate:
        updates["AEGIS_PROVIDER"] = pname

    explicit = os.environ.get("AEGIS_ENV_FILE")
    if explicit:
        target = Path(explicit).expanduser()
    else:
        target = find_env_file() or (repo_root() / ".env.local")

    existing = _parse_env_file(target) if target.is_file() else {}
    merged = dict(existing)
    merged.update(updates)
    lines: list[str] = []
    seen: set[str] = set()
    if target.is_file():
        for raw in target.read_text(encoding="utf-8",
                                     errors="replace").splitlines():
            stripped = raw.strip()
            key = None
            if stripped and not stripped.startswith("#") and "=" in stripped:
                body = stripped
                if body.startswith("export "):
                    body = body[len("export "):].strip()
                key = body.split("=", 1)[0].strip()
            if key and key in updates:
                lines.append(f"{key}={updates[key]}")
                seen.add(key)
            else:
                lines.append(raw)
    for key, value in updates.items():
        if key not in seen:
            lines.append(f"{key}={value}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        target.chmod(0o600)
    except OSError:
        pass

    for key, value in updates.items():
        os.environ[key] = value
    global _FILE_VALUES, _ENV_FILE_USED
    _FILE_VALUES = None
    _ENV_FILE_USED = None
    return llm_status()


def providers_status() -> dict:
    """Secret-free per-provider configuration status for the API:
    provider NAMES and configured BOOLEANS only, plus the active
    provider and the overall llm_status."""
    providers = {}
    for pname in PROVIDER_NAMES:
        providers[pname] = {"configured": provider_config(pname)["key_present"]}
    status = llm_status()
    return {
        "providers": providers,
        "active_provider": status["provider"],
        "active": status["provider"],
        "llm": status,
        "tier": status["tier"],
    }


def hardware_profile() -> dict:
    """User-reported hardware profile. This is NOT detected in this VM;
    it is labelled user-reported everywhere it appears."""
    profile = get_var("AEGIS_LOCAL_PROFILE", "") or "P-LEAN"
    return {
        "profile": profile,
        "profile_source": "user-reported",
        "label": "user-reported profile: P-LEAN (RTX 5050 8GB)",
        "gpu_reported": "NVIDIA RTX 5050 8GB VRAM (115W)",
        "cpu_reported": "AMD Ryzen 7 260 (NPU, Radeon 780M iGPU)",
        "ram_reported": "16GB DDR5-5600",
        "reflex_model_recommendation": "4B Q4",
        "planner_expectation": "cloud planner",
    }


def chat(messages: list[dict], timeout: float = 20.0) -> str:
    """One OpenAI-compatible /chat/completions call via urllib.

    Raises ProviderError (or a urllib exception type) on any failure;
    callers label the failure by exception type name only.
    """
    if no_llm():
        raise ProviderError("llm_disabled_by_env")
    cfg = provider_config()
    if not cfg["key_present"]:
        raise ProviderError("no_key_for_provider")
    if not cfg["base_url"]:
        raise ProviderError("no_base_url_for_provider")
    url = cfg["base_url"] + "/chat/completions"
    payload = json.dumps({
        "model": cfg["model"],
        "messages": messages,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + cfg["key"])
    req.add_header("User-Agent", "AEGIS/0.1.0")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        # Do not include the response body: it is untrusted and unnecessary.
        raise ProviderError(f"http_status_{exc.code}") from exc
    try:
        data = json.loads(raw)
        content = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise ProviderError("malformed_provider_response") from exc
    if not isinstance(content, str) or not content.strip():
        raise ProviderError("empty_provider_response")
    return content.strip()
