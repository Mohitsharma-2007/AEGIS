"""Conversational turn pipeline (AEGIS ONE brain v2).

Mohit's ruling: AEGIS must converse like a normal assistant (Muse/Grok
style) BY DEFAULT. The old brief rule — cite stored evidence or say
"I don't know" — is now the ``provenance_strict`` SETTING (default off,
see settings.py), and it only governs factual/memory answers.

Pipeline (deterministic intent classification first, no LLM needed for
routing):
  1. forged-tool match (memoised call, through the broker),
  2. explicit store: "remember (that) X" and declarative
     "my <thing> is/are <value>" auto-capture,
  3. forget, then URL -> browser.fetch (existing broker behaviour),
  4. greeting / smalltalk / capability / thanks / bye / time-date —
     always conversational, never an abstention, in BOTH toggle states,
  5. narrow tool requests (file list, system info),
  6. everything else: recall FIRST. With evidence, answer with
     citations (a cloud provider may phrase it, grounded in the
     evidence). Without evidence:
       - memory-seeking question -> snapshot flag abstained=true in
         BOTH toggle states; the TEXT is the strict abstention only
         when provenance_strict is on, otherwise a conversational
         "I don't have that stored yet — tell me and I'll remember it."
       - general question -> strict: today's abstention behaviour;
         non-strict online: the provider answers like a normal
         assistant; non-strict offline: a plain spoken explanation
         that nothing is stored and no provider key is configured.
"""
from __future__ import annotations

import re
from datetime import datetime

from . import memory as memory_mod
from . import providers, settings as settings_mod
from . import tools as tools_mod
from .db import Store
from .modes import MODE_NAMES
from .state import STATE

_URL_RE = re.compile(r"https?://[^\s<>\"']+")

PERSONA = (
    "You are AEGIS, a friendly, capable local-first desktop assistant. "
    "Talk like a normal assistant: natural, concise, helpful. Never use "
    "abstention cards or refuse to chat; if you don't know something, "
    "just say so plainly in conversation."
)

# ---------------------------------------------------------------------------
# Built-in (offline) conversational responders — no abstention language.
# ---------------------------------------------------------------------------

GREETING_ANSWER = (
    "Hey! Good to see you — I'm AEGIS, your local-first desktop "
    "assistant. I can chat, remember things for you, browse the web, "
    "and, in Operator mode, help run the computer. What shall we do?"
)

HOW_ARE_YOU_ANSWER = (
    "I'm running well and ready to help — thanks for asking. "
    "What can I do for you?"
)

THANKS_ANSWER = "You're welcome — anytime. Anything else you'd like to do?"

BYE_ANSWER = "Goodbye for now — I'll be right here when you need me."

NO_MEMORY_CONVERSATIONAL = (
    "I don't have that stored yet — tell me and I'll remember it."
)

OFFLINE_GENERAL_ANSWER = (
    "I don't have that stored, and I'm currently offline — no provider "
    "key is configured, so I can't answer that live right now. You can "
    "add a provider key in Settings and I'll answer properly, or tell "
    "me the fact and I'll remember it for next time."
)


def capability_answer() -> str:
    modes = ", ".join(MODE_NAMES)
    return (
        "Here's what I can do:\n"
        "- Chat like a normal assistant — and when a provider key is "
        "configured in Settings, answer general questions live.\n"
        "- Remember facts you tell me (\"remember …\" or \"my … is …\"), "
        "each stored with its source capture, and recall them later "
        "with citations.\n"
        f"- Work in five modes — {modes} — each with its own set of "
        "permissions, enforced before any tool runs.\n"
        "- Use tools through a permission broker: files, system info, "
        "clipboard, notifications and more, asking first before "
        "anything sensitive.\n"
        "- Browse the web in Browser mode with the AEGIS Computer browser "
        "(Playwright) — read pages, take screenshots, and drive the "
        "browser surface.\n"
        "- Research: OpenAlex (scholarly papers/authors) and GitHub "
        "(repositories, trees, commits, files) with provenance capture.\n"
        "- WhatsApp: check connection state, read recent chats, and send "
        "messages when the sidecar is paired.\n"
        "- Talk and listen: voice input and spoken replies in the "
        "desktop app.\n"
        "- Control the OS in Operator mode — launch apps, open URLs, "
        "screenshots — with your confirmation.\n"
        "- Learn from repetition: repeat the same tool action three "
        "times and I forge it into a faster learned tool."
    )


# ---------------------------------------------------------------------------
# Deterministic intent classification (rules only).
# ---------------------------------------------------------------------------

_GREETING_RE = re.compile(
    r"^(hi+|hello|hey+|hiya|howdy|namaste|yo|good\s+(morning|afternoon|evening))"
    r"\b[\s!.,]*(aegis)?[\s!.,]*$", re.IGNORECASE)
_SMALLTALK_PHRASES = (
    "how are you", "how are you doing", "how's it going", "how is it going",
    "what's up", "whats up", "how do you feel", "how is life",
)
_CAPABILITY_PHRASES = (
    "what can you do", "what do you do", "who are you", "what are you",
    "your capabilities", "what are your capabilities", "capabilities",
    "show me what you can do", "what tools do you have",
    "what are your features", "your features", "list your tools",
)
_THANKS_RE = re.compile(r"^(thanks|thank you|thankyou|thx)\b", re.IGNORECASE)
_BYE_RE = re.compile(r"^(bye|goodbye|good night|see you|see ya)\b", re.IGNORECASE)
_TIME_PHRASES = (
    "what time", "current time", "time is it", "time now",
    "what's the date", "what is the date", "today's date", "what date",
    "what day is", "what day is it", "date today", "tell me the time",
    "the time", "the date",
)
# Declarative personal fact: "my favourite editor is Helix".
_FACT_RE = re.compile(
    r"^my\s+(.+?)\s+(is|are)\s+(.+?)\s*$", re.IGNORECASE | re.DOTALL)
_MEMORY_PHRASES = (
    "do you remember", "remember what", "did i tell", "have i told",
    "what did i", "what have i", "recall", "stored", "have you stored",
    "did i store", "did i save", "have i stored",
)
# Stored-fact question about a named entity: "What payment terms does
# Acme want?" / "What is Zorblax's leverage?"
_ENTITY_FACT_RE = re.compile(
    r"\b[A-Z][\w'-]*\s+(?:wants|want|needs|need|prefers|prefer|likes|"
    r"uses|owns|has)\b|\b[A-Z][\w]*'s\b")


def _classify_smalltalk_capability(lowered: str) -> str | None:
    """Greeting/smalltalk/capability/thanks/bye/time — or None."""
    stripped = lowered.strip(" !.,?")
    words = re.findall(r"[a-z']+", stripped)
    if _GREETING_RE.match(lowered.strip()) or stripped in (
            "hi", "hello", "hey", "namaste") or (
            words and words[0] in ("hi", "hello", "hey", "hiya", "howdy",
                                   "namaste", "yo")
            and len(words) <= 4 and "?" not in lowered):
        return "greeting"
    if any(p in lowered for p in _SMALLTALK_PHRASES):
        return "smalltalk"
    if (stripped == "help" or stripped.startswith("help ")
            or any(p in lowered for p in _CAPABILITY_PHRASES)):
        return "capability"
    if _THANKS_RE.match(lowered):
        return "thanks"
    if _BYE_RE.match(lowered):
        return "bye"
    if any(p in lowered for p in _TIME_PHRASES):
        return "time_date"
    return None


def _looks_memory_seeking(text: str, lowered: str) -> bool:
    if any(p in lowered for p in _MEMORY_PHRASES):
        return True
    if re.search(r"\bmy\b", lowered) or re.search(r"\bmine\b", lowered):
        return True
    if _ENTITY_FACT_RE.search(text):
        return True
    return False


def _time_answer() -> str:
    now = datetime.now().astimezone()
    return (f"It's {now.strftime('%A, %d %B %Y')} and the time is "
            f"{now.strftime('%H:%M')} ({now.tzname() or 'local time'}).")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _base(answer: str, citations: list, events: list,
          answer_source: str = "retrieval", **extra) -> dict:
    status = providers.llm_status()
    out = {
        "ok": True,
        "answer": answer,
        "text": answer,
        "citations": citations,
        "tier": status["tier"],
        "llm_tier": status["tier"],
        "llm": status,
        "answer_source": answer_source,
        "provenance_strict": settings_mod.provenance_strict(),
        "rag_enabled": settings_mod.rag_enabled(),
        "events": events,
        "tool_events": events,
    }
    out.update(extra)
    return out


def _dispatch_event(result: dict) -> dict:
    return {"type": "tool", "tool": result.get("tool"),
            "status": result.get("status"),
            "error": result.get("error"),
            "ok": result.get("ok")}


def _store_fact(store: Store, fact: str, events: list) -> dict:
    """Store one explicit fact through the broker (mode rules apply)."""
    result = tools_mod.dispatch(store, "memory.remember", {"text": fact})
    events.append(_dispatch_event(result))
    if result.get("ok"):
        cap = result.get("capture_id")
        return _base(
            f"Got it — remembered: {fact}"
            + (f" (capture {cap})" if cap else ""),
            [cap] if cap else [], events, answer_source="memory_write",
            intent="remember", capture_id=cap, result=result)
    if result.get("error") == "mode_blocked":
        return _base(
            f"I can't store that in {STATE.mode} mode — it blocks memory "
            "writes (missing scope: "
            f"{result.get('missing_scope', 'memory.write')}). Switch "
            "mode and tell me again.",
            [], events, answer_source="conversational",
            intent="remember", error="mode_blocked", result=result)
    return _base(f"Could not remember that: {result.get('error')}",
                 [], events, intent="remember", result=result)


def _chat_or_fallback(messages: list[dict], fallback: str,
                      citations: list, events: list,
                      answer_source_cloud: str = "cloud",
                      intent: str = "general-question") -> dict:
    """Use the provider when the tier is cloud; built-in text otherwise.
    Any provider failure falls back to the built-in text, honestly
    labelled."""
    status = providers.llm_status()
    if status["tier"] != "cloud":
        return _base(fallback, citations, events,
                     answer_source="conversational", intent=intent)
    try:
        reply = providers.chat(messages)
    except Exception as exc:  # provider failure -> honest fallback
        return _base(fallback, citations, events,
                     answer_source="conversational_fallback", intent=intent,
                     llm_error=f"llm_error:{type(exc).__name__}")
    return _base(reply, citations, events, answer_source=answer_source_cloud,
                 intent=intent)


def handle_user_message(store: Store, text: str,
                        confirmed: bool = False,
                        confirmation_source: str | None = None) -> dict:
    STATE.touch()
    text = (text or "").strip()
    if STATE.stopped:
        return {"ok": False, "error": "state_stopped",
                "answer": "AEGIS is stopped (kill switch). Resume to continue.",
                "citations": [], "tier": providers.llm_status()["tier"],
                "answer_source": "retrieval", "events": [], "tool_events": []}
    if not text:
        return _base("Say something, or start with 'remember …'.", [], [],
                     answer_source="conversational")

    events: list[dict] = []
    lowered = text.lower()
    strict = settings_mod.provenance_strict()

    # 1. Forged tools win over a fresh attempt.
    learned = tools_mod.match_forged(store, text)
    if learned is not None:
        # Through the broker with no pre-confirmation: a forged tool never
        # bypasses a permission (once_per_session tools already confirmed
        # this session will pass; `always` tools will ask again).
        result = tools_mod.dispatch(
            store, learned["source_tool"], dict(learned["args"]),
            forged_from=learned["source_tool"], log_tool_name=learned["slug"])
        store.execute(
            "UPDATE learned_tools SET use_count=use_count+1 WHERE slug=?",
            (learned["slug"],))
        events.append(_dispatch_event(result))
        if result.get("ok"):
            detail = result.get("content") or result.get("text") or ""
            answer = (f"Used learned tool {learned['name']} "
                      f"(reused {int(learned['use_count']) + 1} times)."
                      + (f" {detail}" if detail else ""))
            return _base(answer, result.get("citations", []), events,
                         intent="tool-request",
                         learned_tool=learned["slug"], learned=learned,
                         forged=True, result=result)
        return _base(f"Learned tool {learned['name']} failed: "
                     f"{result.get('error', 'error')}", [], events,
                     intent="tool-request",
                     learned_tool=learned["slug"], result=result)

    # 2a. remember … (optionally "please remember …")
    remember_rest = None
    if lowered.startswith("remember"):
        remember_rest = text[len("remember"):]
    elif lowered.startswith("please remember"):
        remember_rest = text[len("please remember"):]
    if remember_rest is not None:
        rest = remember_rest.lstrip(" :")
        if rest.lower().startswith("that "):
            rest = rest[5:]
        rest = rest.strip()
        if rest:
            return _store_fact(store, rest, events)
        return _base("Of course — tell me what to remember and I'll "
                     "store it with its source.", [], events,
                     answer_source="conversational", intent="remember")

    # 2b. Auto-capture: declarative "my <thing> is/are <value>".
    if "?" not in text:
        fact_match = _FACT_RE.match(text.rstrip("."))
        if fact_match:
            return _store_fact(store, text.rstrip(".").strip(), events)

    # 2c. forget …
    if lowered.startswith("forget"):
        rest = text[len("forget"):].lstrip(" :")
        if rest.lower().startswith("that "):
            rest = rest[5:]
        found = memory_mod.recall(store, rest or text)
        if found.get("abstained") or not found.get("results"):
            return _base(memory_mod.ABSTAIN_MESSAGE, [], events,
                         intent="forget", abstained=True)
        target = found["results"][0]
        result = tools_mod.dispatch(
            store, "memory.forget", {"memory_id": target["id"]},
            confirmed=confirmed, confirmation_source=confirmation_source)
        events.append(_dispatch_event(result))
        if result.get("error") == "permission_required":
            return _base("Forgetting needs a keyboard confirmation — "
                         "I can't do it without one.",
                         [target["capture_id"]], events, intent="forget",
                         error="permission_required", result=result)
        if result.get("error") == "voice_confirmation_refused":
            return _base("Voice confirmation is refused for forgetting — "
                         "confirm with the keyboard instead.",
                         [target["capture_id"]], events, intent="forget",
                         error="voice_confirmation_refused", result=result)
        if result.get("ok"):
            return _base(f"Forgotten: {target['text']}",
                         [target["capture_id"]], events, intent="forget",
                         result=result)
        return _base(f"Could not forget that: {result.get('error')}",
                     [], events, intent="forget", result=result)

    # 2d. URL -> browser.fetch (through the broker, so mode gating applies).
    url_match = _URL_RE.search(text)
    if url_match:
        url = url_match.group(0).rstrip(".,)")
        result = tools_mod.dispatch(store, "browser.fetch", {"url": url})
        events.append(_dispatch_event(result))
        if result.get("error") == "mode_blocked":
            missing = result.get("missing_scope", "network.get")
            return _base(f"That needs a web fetch, which the current mode "
                         f"({STATE.mode}) blocks — missing scope: {missing}. "
                         f"Switch to Browser mode to allow it.",
                         [], events, intent="tool-request",
                         error="mode_blocked", result=result)
        if result.get("ok"):
            cap = result.get("capture_id")
            snippet = (result.get("text") or "")[:400]
            return _base(f"Fetched {url} (engine: {result.get('engine')}, "
                         f"{result.get('note')}): {snippet}",
                         [cap] if cap else [], events,
                         intent="tool-request", result=result)
        return _base(f"Fetch failed: {result.get('error')}", [], events,
                     intent="tool-request", result=result)

    # 3. Greeting / smalltalk / capability / thanks / bye / time-date.
    #    Conversational in BOTH toggle states — never an abstention.
    social = _classify_smalltalk_capability(lowered)
    if social == "greeting":
        return _chat_or_fallback(
            [{"role": "system", "content": PERSONA},
             {"role": "user", "content": text}],
            GREETING_ANSWER, [], events, answer_source_cloud="cloud",
            intent="greeting")
    if social == "smalltalk":
        return _base(HOW_ARE_YOU_ANSWER, [], events,
                     answer_source="conversational", intent="smalltalk")
    if social == "capability":
        # The built-in summary is the accurate one; use it in both tiers
        # so the answer never invents features.
        return _base(capability_answer(), [], events,
                     answer_source="conversational", intent="capability")
    if social == "thanks":
        return _base(THANKS_ANSWER, [], events,
                     answer_source="conversational", intent="thanks")
    if social == "bye":
        return _base(BYE_ANSWER, [], events,
                     answer_source="conversational", intent="bye")
    if social == "time_date":
        return _base(_time_answer(), [], events,
                     answer_source="local_clock", intent="time_date")

    # 4. Narrow deterministic tool requests (existing tool behaviour).
    if re.search(r"\b(list|show|ls)\b.*\bfiles?\b", lowered) or \
            lowered.strip() in ("list files", "show files"):
        result = tools_mod.dispatch(store, "file.list", {})
        events.append(_dispatch_event(result))
        if result.get("ok"):
            names = [e.get("name", "") for e in result.get("entries", [])]
            answer = ("Files in the workspace: " + ", ".join(names)
                      if names else "The workspace is empty.")
            return _base(answer, [], events, answer_source="tool",
                         intent="tool-request", result=result)
        return _base(f"Could not list files: {result.get('error')}",
                     [], events, intent="tool-request", result=result)
    if "system info" in lowered or "system information" in lowered:
        result = tools_mod.dispatch(store, "system.info", {})
        events.append(_dispatch_event(result))
        if result.get("ok"):
            answer = (f"System: {result.get('platform')} "
                      f"{result.get('platform_release')} on "
                      f"{result.get('machine')}, "
                      f"{result.get('cpu_count')} CPUs, Python "
                      f"{result.get('python')}. GPU: "
                      f"{result.get('gpu', {}).get('detail', 'unknown')}")
            return _base(answer, [], events, answer_source="tool",
                         intent="tool-request", result=result)
        return _base(f"Could not get system info: {result.get('error')}",
                     [], events, intent="tool-request", result=result)

    # 5. Recall first — cited memory answers in both toggle states.
    #    RAG toggle: when rag_enabled is OFF, no retrieved memory
    #    context is assembled or injected into the turn at all. Memory
    #    still records captures (steps 2a/2b above) and the explicit
    #    recall tools still work when invoked directly; only this
    #    automatic per-turn retrieval is gated. (The forget path at 2c
    #    uses recall to locate its explicit target — that is a direct
    #    user command, not context injection, so it is not gated.)
    if settings_mod.rag_enabled():
        found = memory_mod.recall(store, text)
    else:
        found = {"ok": True, "abstained": True, "results": [],
                 "citations": [], "rag_enabled": False}
    if found.get("results"):
        results = found["results"]
        citations = found["citations"]
        retrieval_answer = results[0]["text"]
        if len(results) > 1:
            retrieval_answer = "; ".join(r["text"] for r in results)
        status = providers.llm_status()
        if status["tier"] != "cloud":
            return _base(retrieval_answer, citations, events,
                         answer_source="retrieval", intent="memory-question")
        evidence = "\n".join(f"- {r['text']}" for r in results)
        try:
            phrased = providers.chat([
                {"role": "system",
                 "content": "You are AEGIS. Answer briefly using ONLY the "
                            "provided evidence. Do not add facts, numbers, "
                            "or citations that are not in the evidence."},
                {"role": "user",
                 "content": f"Question: {text}\nEvidence:\n{evidence}"},
            ])
        except Exception as exc:  # provider failure -> honest fallback
            return _base(retrieval_answer, citations, events,
                         answer_source="retrieval_fallback",
                         intent="memory-question",
                         llm_error=f"llm_error:{type(exc).__name__}")
        return _base(phrased, citations, events,
                     answer_source="cloud+retrieval", intent="memory-question")

    # 6. No stored evidence.
    if _looks_memory_seeking(text, lowered):
        # The abstained FLAG stays true in both toggle states (the AG-UI
        # interop contract asserts it); only the reply TEXT changes.
        if strict:
            return _base(memory_mod.ABSTAIN_MESSAGE, [], events,
                         intent="memory-question", abstained=True)
        return _base(NO_MEMORY_CONVERSATIONAL, [], events,
                     answer_source="conversational",
                     intent="memory-question", abstained=True)

    # General question.
    if strict:
        # Strict semantics = the old behaviour for factual answers.
        return _base(memory_mod.ABSTAIN_MESSAGE, [], events,
                     intent="general-question", abstained=True)
    return _chat_or_fallback(
        [{"role": "system", "content": PERSONA},
         {"role": "user", "content": text}],
        OFFLINE_GENERAL_ANSWER, [], events, answer_source_cloud="cloud")
