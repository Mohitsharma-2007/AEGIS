"""Deterministic cleanup for speech-to-text transcripts.

Speech models (Whisper included) are good at hearing words and bad at writing
them down the way a person would.  Voice input arrives with hesitation sounds,
stutters, false starts, self-corrections and the occasional split number.  This
module turns that stream into the sentence the user *meant* before it reaches
the language model.

The rules are intentionally conservative and completely local: no network call
is needed to remove fillers or resolve "500, not 500, 600, not 600, 200".  An
optional tiny LLM pass can be layered on top for grammar and punctuation, but
the deterministic pass is always the source of truth for numbers.

Examples
--------
>>> clean_transcript("um, I I I want 500, not 500, 600, not 600, 200")
'I want 200.'
>>> clean_transcript("set it to 5 0 0 6")
'Set it to 5006.'
"""

from __future__ import annotations

import re
import unicodedata
from typing import Awaitable, Callable

# Devanagari block.  Hindi is written in this script; Hinglish often mixes
# Devanagari and Latin words in one sentence.
_DEVANAGARI = "\u0900-\u097F"
_WORD = rf"A-Za-z{_DEVANAGARI}"

# Words that carry no intent on their own.  "a" is deliberately absent: it is
# an English article far more often than a hesitation sound.  Devanagari "अ"
# is included because it is the Hindi filler that sounds like "a".
_FILLERS = re.compile(
    rf"(?iu)(?<![{_WORD}])(?:u+m+|u+h+|e+r+m?|a+h+|h+m+|m+h+m+|\u0905\u0902?|\u0909\u092e+|\u0909\u0939+|\u0939\u092e\u094d\u092e+)(?![{_WORD}])\s*[,;]?\s*",
)

# "you know," / "matlab," at a clause boundary.  These are discourse markers,
# not content.  "I mean" is handled with the correction markers below so that
# "I mean 500" keeps the number.
_DISCOURSE = re.compile(
    rf"(?iu)(?:^|(?<=[.!?\u0964]\s))(?:you know|matlab|\u092e\u0924\u0932\u092c)\s*[,;]?\s*",
)

_CORRECTION_MARKER = (
    r"no|not|nope|nahi|nahin|sorry|rather|actually|i mean|i meant|i said|"
    r"\u092e\u0924\u0932\u092c|\u092f\u093e\u0928\u0940|\u0928\u0939\u0940\u0902|"
    r"\u0917\u0932\u0924"
)
# A number with optional thousand separators.  Order matters: the grouped form
# is tried first so "5,006" is one number instead of "5" followed by "006".
_NUMBER = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
_NUMBER_CLAUSE = rf"(?:(?:{_CORRECTION_MARKER})\s*,?\s*)?{_NUMBER}"
# Numbers separated by commas/semicolons form a chain.  If any clause in the
# chain contains a correction marker, the last number is the intended value.
_NUMBER_CHAIN = re.compile(
    rf"(?<![\w])(?P<chain>{_NUMBER}(?:\s*[,;]?\s*{_NUMBER_CLAUSE})+)(?![\w])",
    re.IGNORECASE,
)

# "John, no, Mary" -> "Mary".  Restrict the old value to a single proper noun
# or number so we never delete a whole phrase such as "send it to John".
_SINGLE_CORRECTION = re.compile(
    r"(?iu)(?<![\w])(?P<old>[A-Z][\w'\u2019-]*|\d[\d,.]*)\s*[,;]\s*"
    rf"(?:{_CORRECTION_MARKER})\s*[,;]?\s*"
    r"(?P<new>[A-Z][\w'\u2019-]*|\d[\d,.]*)(?![\w])",
)

# Words split into single digits by the decoder: "5 0 0 6" -> 5006.
_SPLIT_DIGITS = re.compile(r"(?<![\w.,])(\d{1,2}(?:[ \t,]+\d{1,2}){1,})(?![\w,])")

_GROUPED_NUMBER = re.compile(r"\b\d{1,3}(?:,\d{3})+\b")

_COMMON_SPELLING = {
    "teh": "the",
    "recieve": "receive",
    "recieved": "received",
    "definately": "definitely",
    "seperate": "separate",
    "occured": "occurred",
    "untill": "until",
    "wich": "which",
    "thier": "their",
}
_CONTRACTION = re.compile(
    r"(?iu)\b(dont|cant|wont|didnt|doesnt|isnt|arent|wasnt|werent|"
    r"wouldnt|couldnt|shouldnt|havent|hasnt|hadnt|aint)\b"
)
_CONTRACTION_MAP = {
    "dont": "don't",
    "cant": "can't",
    "wont": "won't",
    "didnt": "didn't",
    "doesnt": "doesn't",
    "isnt": "isn't",
    "arent": "aren't",
    "wasnt": "wasn't",
    "werent": "weren't",
    "wouldnt": "wouldn't",
    "couldnt": "couldn't",
    "shouldnt": "shouldn't",
    "havent": "haven't",
    "hasnt": "hasn't",
    "hadnt": "hadn't",
    "aint": "ain't",
}

_GRAMMAR_FIXES: list[tuple[str, str]] = [
    (r"(?iu)\bi is\b", "I am"),
    (r"(?iu)\bi are\b", "I am"),
    (r"(?iu)\bi has\b", "I have"),
    (r"(?iu)\b(he|she|it) are\b", r"\1 is"),
    (r"(?iu)\b(he|she|it) have\b", r"\1 has"),
    (r"(?iu)\b(they|we|you) is\b", r"\1 are"),
    (r"(?iu)\b(they|we|you) has\b", r"\1 have"),
]


def _fix_grammar(text: str) -> str:
    for pattern, replacement in _GRAMMAR_FIXES:
        text = re.sub(pattern, replacement, text)
    return text


_SENTENCE_START = re.compile(rf"(^|[.!?\u0964]\s+)([a-z{_DEVANAGARI}])")


def _looks_like_question(text: str) -> bool:
    """True for a spoken question, with or without a question mark.

    Whisper usually ends English and Hindi questions with ``?`` but sometimes
    emits the Devanagari danda.  Requiring an interrogative word as well keeps
    ordinary statements that merely contain a danda out of this path.
    """
    value = (text or "").strip()
    if not value:
        return False
    if "?" in value:
        return True
    return bool(_QUESTION_WORDS.search(value)) and bool(
        re.search(r"[\u0964?]\s*$", value)
    )


def needs_llm_cleanup(raw: str) -> bool:
    """Whether a transcript is messy enough to justify a network round-trip.

    Clean four-word commands should reach the language model immediately.  The
    optional polish pass is reserved for false starts, self-corrections and
    long, rambling sentences where grammar and punctuation matter most.
    Questions are deliberately skipped: a cleanup model must never be invited
    to answer the user's question before the real assistant sees it.
    """
    value = (raw or "").strip()
    if _looks_like_question(value):
        return False
    if len(value.split()) >= 10:
        return True
    return bool(
        re.search(
            rf"(?iu)(?<![\w])(?:u+m+|u+h+|e+r+m?|a+h+|h+m+|"
            rf"no|not|nahi|sorry|rather|i mean|i meant|\u0928\u0939\u0940\u0902)"
            rf"(?![\w])",
            value,
        )
    )



def _strip_fillers(text: str) -> str:
    text = _DISCOURSE.sub(" ", text)
    text = _FILLERS.sub(" ", text)
    # "a" / "\u0905" only when it is clearly an isolated hesitation, not an
    # article: "a, I think" or "a a".  Never touch "a table".
    text = re.sub(rf"(?iu)(?:^|(?<=[,;]\s))a\s*[,;]\s*", " ", text)
    text = re.sub(rf"(?iu)(?<![\w])(?:\u0905|\u0906)\s*[,;]\s*", " ", text)
    return text


def _collapse_stutters(text: str) -> str:
    # Single-word repeats: "I I I want" -> "I want", "very very good" -> "very good".
    previous = None
    while previous != text:
        previous = text
        text = re.sub(
            rf"(?iu)\b([{_WORD}][\w'\u2019-]*)(?:\s*[,;]?\s+\1\b)+",
            r"\1",
            text,
        )
    # Short phrase repeats: "I want to I want to go" -> "I want to go".
    for _ in range(3):
        updated = re.sub(
            rf"(?iu)\b((?:[{_WORD}][\w'\u2019-]*[\s,]+){{1,3}}[{_WORD}][\w'\u2019-]*)"
            rf"(?:[\s,]+\1\b)+",
            r"\1",
            text,
        )
        if updated == text:
            break
        text = updated
    return text


def _resolve_numeric_corrections(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        chain = match.group("chain")
        if not re.search(rf"(?i)(?:{_CORRECTION_MARKER})", chain):
            return chain
        numbers = re.findall(_NUMBER, chain)
        if not numbers:
            return chain
        # The final value is the one the speaker settled on.  This is exactly
        # what "500, not 500, 600, not 600, 200" should produce: 200.
        return numbers[-1]

    return _NUMBER_CHAIN.sub(replace, text)


def _resolve_single_corrections(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        old = match.group("old")
        new = match.group("new")
        if old.casefold() == new.casefold():
            return old
        return new

    return _SINGLE_CORRECTION.sub(replace, text)


def _join_split_digits(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        raw = match.group(0)
        parts = re.findall(r"\d+", raw)
        if not parts:
            return raw
        all_single = all(len(part) == 1 for part in parts)
        has_leading_zero = any(len(part) > 1 and part.startswith("0") for part in parts)
        # Four or more single digits is almost always one number read digit by
        # digit ("5 0 0 6").  A 00/06-looking chunk is the same signal.
        if (all_single and len(parts) >= 4) or (
            has_leading_zero and len(parts) >= 2 and all(len(part) <= 2 for part in parts)
        ):
            return "".join(parts)
        return raw

    return _SPLIT_DIGITS.sub(replace, text)


def _strip_grouping_commas(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        digits = match.group(0).replace(",", "")
        # Keep separators for genuinely large numbers; 5006 and 10000 are
        # easier for a language model (and a human) without them.
        return digits if len(digits) <= 6 else match.group(0)

    return _GROUPED_NUMBER.sub(replace, text)


def _fix_common_spelling(text: str) -> str:
    def contraction(match: re.Match[str]) -> str:
        return _CONTRACTION_MAP[match.group(1).casefold()]

    text = _CONTRACTION.sub(contraction, text)
    for wrong, right in _COMMON_SPELLING.items():
        text = re.sub(rf"(?iu)\b{wrong}\b", right, text)
    # The pronoun "I" is never lowercase in written English.
    text = re.sub(r"(?iu)\bi\b", "I", text)
    text = re.sub(r"(?iu)\bi'(m|ve|ll|d)\b", lambda m: f"I'{m.group(1).lower()}", text)
    text = re.sub(r"(?iu)\baegis\b", "Aegis", text)
    return text


def _clean_punctuation(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s+([,;:.!?\u0964])", r"\1", text)
    text = re.sub(r"([,;:])(?=[^\s\d])", r"\1 ", text)
    text = re.sub(rf"([.!?\u0964])(?=[{_WORD}])", r"\1 ", text)
    text = re.sub(r"([,;:])(?:\s*[,;:])+", r"\1", text)
    text = re.sub(r"([.!?])\1{2,}", r"\1\1", text)
    text = re.sub(r"^[\s,;:.!?\u0964-]+", "", text)
    return text.strip()


def _capitalise_sentences(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        return match.group(1) + match.group(2).upper()

    return _SENTENCE_START.sub(replace, text)


def clean_transcript(raw: str) -> str:
    """Return the clean, written form of a spoken sentence."""
    if not raw:
        return ""
    text = unicodedata.normalize("NFC", raw)
    # Normalise smart punctuation produced by some decoders.
    text = (
        text.replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u00a0", " ")
    )
    text = _strip_fillers(text)
    text = _collapse_stutters(text)
    text = _resolve_numeric_corrections(text)
    text = _resolve_single_corrections(text)
    text = _join_split_digits(text)
    text = _strip_grouping_commas(text)
    text = _fix_common_spelling(text)
    text = _fix_grammar(text)
    text = _clean_punctuation(text)
    text = _capitalise_sentences(text)
    if text and text[-1] not in ".!?\u0964\u2026":
        text += "."
    return text


# ---------------------------------------------------------------------------
# Optional LLM polishing
# ---------------------------------------------------------------------------

Cleaner = Callable[[str], Awaitable[str | None]]

_LLM_SYSTEM = (
    "You clean up voice transcripts. Rewrite the text as clear written "
    "language. Remove fillers, stutters, false starts, and self-corrections; "
    "keep only the final value the speaker intended. Never split a multi-digit "
    "number and never invent numbers. Fix grammar, punctuation and "
    "capitalisation. Keep Hindi in Devanagari script and keep English words in "
    "Latin script. Preserve the speaker's meaning and language. If the input "
    "is a question, keep it a question and NEVER answer it: return the "
    "question itself, cleaned up. Reply with the cleaned text only, without "
    "quotes, labels or commentary."
)

_QUESTION_END = re.compile(r"[?\u0964]")

# Interrogatives that must survive a rewrite of a question.  Both English and
# Hindi forms are listed because Hinglish switches between them mid-sentence.
_QUESTION_WORDS = re.compile(
    r"(?iu)(?<![\w])(?:what|why|how|when|where|who|whom|whose|which|"
    r"can|could|would|will|should|shall|do|does|did|is|are|was|were|"
    r"kya|kaise|kaisa|kaisi|kahan|kab|kaun|kaunsa|kaunsi|kitna|kitne|kitni|"
    r"\u0915\u094d\u092f\u093e|\u0915\u0948\u0938\u0947|\u0915\u0948\u0938\u093e|"
    r"\u0915\u0939\u093e\u0901|\u0915\u092c|\u0915\u094c\u0928|"
    r"\u0915\u093f\u0924\u0928\u093e|\u0915\u093f\u0924\u0928\u0947|"
    r"\u0915\u093f\u0924\u0928\u0940)(?![\w])"
)

# Wh-words carry the question's intent.  If one is present, a cleanup that
# replaces the question with an answer will almost certainly drop it.
_WH_WORDS = re.compile(
    r"(?iu)(?<![\w])(?:what|why|how|when|where|who|whom|whose|which|"
    r"kya|kaise|kaisa|kaisi|kahan|kab|kaun|kaunsa|kaunsi|kitna|kitne|kitni|"
    r"\u0915\u094d\u092f\u093e|\u0915\u0948\u0938\u0947|\u0915\u0948\u0938\u093e|"
    r"\u0915\u0939\u093e\u0901|\u0915\u092c|\u0915\u094c\u0928|"
    r"\u0915\u093f\u0924\u0928\u093e|\u0915\u093f\u0924\u0928\u0947|"
    r"\u0915\u093f\u0924\u0928\u0940)(?![\w])"
)


def _safe_llm_cleanup(original: str, candidate: str) -> bool:
    text = candidate.strip().strip('"').strip("'").strip()
    if not text or len(text) < 2:
        return False
    if len(text) > max(80, len(original) * 3):
        return False
    if not re.search(rf"[{_WORD}]", text):
        return False
    # A cleanup pass must never turn a question into an answer.  Require the
    # candidate to stay interrogative and to keep an interrogative word.
    if _looks_like_question(original):
        if not _QUESTION_END.search(text):
            return False
        if _QUESTION_WORDS.search(original) and not _QUESTION_WORDS.search(text):
            return False
        if _WH_WORDS.search(original) and not _WH_WORDS.search(text):
            return False
    # Every digit sequence in the rewrite must have appeared in the input.
    # This blocks the model from "fixing" 5006 into 5,006 or 50000.
    original_digits = set(re.findall(r"\d+", original))
    for number in re.findall(r"\d+", text):
        if number not in original_digits and number.replace(",", "") not in {
            value.replace(",", "") for value in original_digits
        }:
            return False
    return True


class LlmTranscriptCleaner:
    """A tiny, timeout-guarded rewrite pass for grammar and punctuation."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float = 2.5,
    ):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    async def __call__(self, text: str) -> str | None:
        import httpx

        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _LLM_SYSTEM},
                {"role": "user", "content": text},
            ],
            "temperature": 0,
            # gpt-oss spends part of the budget on reasoning before it writes
            # the answer, so keep enough room for both.
            "max_tokens": min(512, max(320, len(text) // 2 + 96)),
        }
        if "gpt-oss" in self._model.lower():
            payload["reasoning_effort"] = "low"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/139.0.0.0 Safari/537.36"
            ),
        }
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                f"{self._base_url}/chat/completions",
                json=payload,
                headers=headers,
            )
            if response.status_code == 400 and "reasoning_effort" in payload:
                # Older OpenAI-compatible servers may not know the field.
                payload.pop("reasoning_effort", None)
                response = await client.post(
                    f"{self._base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                )
            response.raise_for_status()
            body = response.json()
        choices = body.get("choices") or []
        if not choices:
            return None
        content = (choices[0].get("message") or {}).get("content") or ""
        cleaned = str(content).strip()
        cleaned = re.sub(r"^(?:cleaned(?: text)?|transcript)\s*:\s*", "", cleaned, flags=re.I)
        cleaned = cleaned.strip().strip('"').strip("'").strip()
        if not _safe_llm_cleanup(text, cleaned):
            return None
        # Re-run the local rules so the final text keeps the same punctuation
        # and number policy even if the model got creative.
        return clean_transcript(cleaned)
