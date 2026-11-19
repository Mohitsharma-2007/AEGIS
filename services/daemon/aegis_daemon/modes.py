"""Five modes as capability (scope) masks, enforced inside tool dispatch."""
from __future__ import annotations

ASSISTANT = {
    "memory.read", "memory.write", "file.read", "system.info",
    "notify", "clipboard.read", "speech",
}

MODES: dict[str, set[str]] = {
    "Assistant": set(ASSISTANT),
    "Operator": set(ASSISTANT) | {
        "file.write", "clipboard.write", "launch", "open_url", "screen.capture",
        # Embedded-browser control (browser.navigate/click/type) is an
        # operator capability as well as a Browser-mode capability.
        "browser.control",
        # CUA / OS computer control (cua.* via agent-desktop) is Operator ONLY:
        # it drives the real desktop, so no other mode may hold this scope.
        "cua.control",
        # WhatsApp (W-FIX 3d): sending from the user's own paired account
        # is an operator action; reading pairs with Browser below.
        "whatsapp.read", "whatsapp.send",
    },
    "Browser": {
        "memory.read", "memory.write", "file.read",
        "network.get", "browser.fetch", "browser.screenshot",
        # Driving the AEGIS Computer browser (navigate/click/type) via the
        # host surface.
        "browser.control",
        # WhatsApp reads sit with the other network reads.
        "whatsapp.read",
    },
    "Memory": {"memory.read", "memory.write"},
    "Silent": set(ASSISTANT) - {"speech"},
}

MODE_NAMES = list(MODES.keys())
DEFAULT_MODE = "Assistant"


def scopes_for(mode: str) -> set[str]:
    return MODES.get(mode, set())
