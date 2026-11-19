"""Aegis command vocabulary for Windows command-only voice access.

Windows' ``SpeechRecognitionListConstraint`` matches an utterance against a
fixed list of phrases, which is exactly what "command-only" access means: the
recogniser never returns free text, so a command can never be mistaken for a
question, and the round trip stays short.

Every entry maps to an *intent*.  The bridge resolves an intent to one of:

``ui``       - the running Aegis window performs it (switch surface, focus a
               field, close a panel)
``computer`` - the AEGIS Computer surface performs it (click, scroll, type),
               mirroring the navigation vocabulary of Windows Voice Access
``voice``    - the voice session itself reacts (stop speaking, mute, repeat)
``host``     - the Aegis server is asked to change something (settings, tasks)
``ask``      - the next utterance is captured as dictation and answered by the
               Aegis language model
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping


@dataclass(frozen=True)
class VoiceCommand:
    """One spoken command and the intent it triggers."""

    phrase: str
    intent: str
    payload: Mapping[str, Any] = field(default_factory=dict)
    reply: str = ""


def _ui(phrase: str, action: str, reply: str = "") -> VoiceCommand:
    return VoiceCommand(phrase, "ui", {"action": action}, reply)


def _computer(phrase: str, action: str, reply: str = "") -> VoiceCommand:
    return VoiceCommand(phrase, "computer", {"action": action}, reply)


def _voice(phrase: str, action: str, reply: str = "") -> VoiceCommand:
    return VoiceCommand(phrase, "voice", {"action": action}, reply)


def _host(
    phrase: str,
    method: str,
    path: str,
    body: Mapping[str, Any] | None = None,
    reply: str = "",
) -> VoiceCommand:
    return VoiceCommand(
        phrase,
        "host",
        {"method": method, "path": path, "body": dict(body or {})},
        reply,
    )


# --- the vocabulary ---------------------------------------------------------

COMMANDS: list[VoiceCommand] = [
    # Aegis surfaces -------------------------------------------------------
    _ui("open settings", "open-settings", "Opening settings."),
    _ui("show settings", "open-settings", "Opening settings."),
    _ui("open preferences", "open-settings", "Opening settings."),
    _ui("open chat", "open-chat", "Opening the conversation."),
    _ui("show chat", "open-chat", "Opening the conversation."),
    _ui("new chat", "new-chat", "Starting a new conversation."),
    _ui("new conversation", "new-chat", "Starting a new conversation."),
    _ui("open files", "open-files", "Opening files."),
    _ui("open documents", "open-files", "Opening files."),
    _ui("show files", "open-files", "Opening files."),
    _ui("open browser", "open-browser", "Opening the browser."),
    _ui("show browser", "open-browser", "Opening the browser."),
    _ui("open terminal", "open-terminal", "Opening the terminal."),
    _ui("open console", "open-terminal", "Opening the terminal."),
    _ui("open activity", "open-activity", "Opening activity."),
    _ui("show activity", "open-activity", "Opening activity."),
    _ui("open computer", "open-computer", "Opening AEGIS Computer."),
    _ui("show desktop", "open-computer", "Opening AEGIS Computer."),
    _ui("open memory", "open-memory", "Opening memory."),
    _ui("open memories", "open-memory", "Opening memory."),
    _ui("open agents", "open-agents", "Opening agents."),
    _ui("open connections", "open-connections", "Opening connections."),
    _ui("open marketplace", "open-marketplace", "Opening the marketplace."),
    _ui("open companion", "open-companion", "Opening companion."),
    _ui("open goals", "open-goals", "Opening goals."),
    _ui("open ideas", "open-ideas", "Opening ideas."),
    _ui("open apps", "open-apps", "Opening apps."),
    _ui("close panel", "close-panel", "Closing the panel."),
    _ui("close the panel", "close-panel", "Closing the panel."),
    _ui("close window", "close-panel", "Closing the panel."),
    _ui("focus message", "focus-composer", "Type your message."),
    _ui("focus search", "focus-search", "Type what to search for."),
    _ui("go back", "go-back", "Going back."),
    # Voice session --------------------------------------------------------
    _voice("stop speaking", "stop-speaking", "Stopped."),
    _voice("be quiet", "stop-speaking", "Stopped."),
    _voice("stop talking", "stop-speaking", "Stopped."),
    _voice("cancel", "cancel", "Cancelled."),
    _voice("mute", "mute", "Muted."),
    _voice("unmute", "unmute", "Unmuted."),
    _voice("repeat that", "repeat", "Saying it again."),
    _voice("say that again", "repeat", "Saying it again."),
    _voice("stop listening", "stop-listening", "Stopped listening."),
    _voice("start listening", "start-listening", "Listening."),
    _voice("help", "help", ""),
    _voice("what can i say", "help", ""),
    _voice("show commands", "help", ""),
    # AEGIS Computer (Voice Access style navigation) -----------------------
    _computer("click", "click", ""),
    _computer("scroll down", "scroll-down", ""),
    _computer("scroll up", "scroll-up", ""),
    _computer("press enter", "press-enter", ""),
    _computer("press escape", "press-escape", ""),
    _computer("press tab", "press-tab", ""),
    _computer("copy", "copy", "Copied."),
    _computer("paste", "paste", "Pasted."),
    _computer("select all", "select-all", "Selected all."),
    # Conversational --------------------------------------------------------
    VoiceCommand("ask aegis", "ask", {}, ""),
    VoiceCommand("ask", "ask", {}, ""),
    VoiceCommand("hey aegis", "ask", {}, ""),
    # Server side ----------------------------------------------------------
    _host(
        "pause aegis",
        "PATCH",
        "/api/settings",
        {"paused": True},
        "Pausing Aegis.",
    ),
    _host(
        "resume aegis",
        "PATCH",
        "/api/settings",
        {"paused": False},
        "Resuming Aegis.",
    ),
]


def _normalise(phrase: str) -> str:
    """Lower-case, strip punctuation and collapse whitespace."""
    cleaned = []
    for char in (phrase or "").lower().strip():
        if char.isalnum() or char.isspace():
            cleaned.append(char)
        else:
            cleaned.append(" ")
    return " ".join("".join(cleaned).split())


# Words that carry no meaning for command matching, so "please open the
# settings" still resolves to "open settings".
_FILLER_WORDS = {
    "the",
    "a",
    "an",
    "my",
    "your",
    "please",
    "just",
    "now",
    "hey",
    "ok",
    "okay",
    "show",
    "open",
}


def _tokens(phrase: str) -> list[str]:
    value = _normalise(phrase)
    if not value:
        return []
    words = [word for word in value.split() if word not in _FILLER_WORDS]
    return words or value.split()


_INDEX: dict[str, VoiceCommand] = {_normalise(c.phrase): c for c in COMMANDS}
_TOKEN_INDEX: dict[str, VoiceCommand] = {}
for _command in COMMANDS:
    _TOKEN_INDEX.setdefault(" ".join(_tokens(_command.phrase)), _command)


def phrases() -> list[str]:
    """The literal phrases handed to the Windows recogniser."""
    return [command.phrase for command in COMMANDS]


def resolve(phrase: str) -> VoiceCommand | None:
    """Map a spoken phrase onto a command.

    The Windows recogniser returns the phrase it matched, so an exact lookup
    is the normal path; the token fallback covers filler words, punctuation
    and case differences introduced by dictation-style input.
    """
    value = (phrase or "").strip()
    if not value:
        return None
    command = _INDEX.get(_normalise(value))
    if command is not None:
        return command
    tokens = _tokens(value)
    if not tokens:
        return None
    joined = " ".join(tokens)
    command = _TOKEN_INDEX.get(joined)
    if command is not None:
        return command
    # Accept a small amount of slack: "open the settings" -> "open settings".
    for candidate, command in _TOKEN_INDEX.items():
        if candidate and (candidate in joined or joined in candidate):
            return command
    return None


def command_summary() -> list[dict[str, Any]]:
    """A JSON friendly description of the vocabulary (used by the UI)."""
    return [
        {
            "phrase": command.phrase,
            "intent": command.intent,
            "action": command.payload.get("action", ""),
            "reply": command.reply,
        }
        for command in COMMANDS
    ]


def describe(commands: Iterable[VoiceCommand] = COMMANDS) -> str:
    """A spoken summary of the available commands."""
    groups: dict[str, list[str]] = {}
    for command in commands:
        if command.intent in {"ask"}:
            continue
        groups.setdefault(command.intent, []).append(command.phrase)
    parts: list[str] = []
    for intent, phrases_ in groups.items():
        parts.append(f"{intent}: {', '.join(phrases_[:6])}")
    return "; ".join(parts)
