#!/usr/bin/env python3
# kit_version: 1
"""Leo's Telegram poller — Wave B provisioning (agent-setup-kit v1.1).

Runs inside WSL Ubuntu-Leo at /root/claudeclaw-leo/leo_poller.py under systemd
service `claude-tg-leo`. Client-facing shape, DM-only: long-polls @cwleodbot,
gates hard on coxwell's user_id + private chat type, spawns `claude --print`
(model + effort PINNED) in the Leo workspace, relays the reply.

DERIVED FROM iris_tg_poller.py (IRIS-BASE, marcus m16149). Deltas vs base:
  + model/effort pins on every spawn: --model claude-sonnet-5 --effort medium
    (kit rule: unpinned --print drifts with CLI updates; unpinned effort burns)
  + FF.1 status writer: .agent-status.json IDLE/WORKING + 60s heartbeat
  + usage-feed shim (lib/usage_emit, import-guarded) + self-halt rails:
    session >=70% or week-agent >=75% -> decline politely, BLOCKER pill, skip
  + bus-secondary thread: polls /messages?for=leo (fable _req pattern, tolerant
    of non-JSON bridge responses) so marcus can reach Leo directly (5-check #3)
  + status pill target: ATLAS COMMAND / Leo topic (chat -1003904308605 / 2746)
  - dropped: outbound mockup image relay (Iris-specific; Leo's work is code)
  = kept: inbound photo/image-doc download (attachments/incoming/) so coxwell
    can DM screenshots; session continuity via --continue + /new //reset

Pure stdlib. Run direct (debug): cd /root/claudeclaw-leo && python3 leo_poller.py
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime, timezone
from pathlib import Path

WORKSPACE = Path("/root/claudeclaw-leo")
TOKEN_PATH = Path("/root/leo-telegram-token.txt")
STATE_FILE = Path("/root/.leo-tg-state.json")
STATUS_FILE = WORKSPACE / ".agent-status.json"
ATLAS_CONFIG_PATH = WORKSPACE / ".atlas-command.json"
ATTACH_INCOMING = WORKSPACE / "attachments" / "incoming"

AGENT_ID = "leo"
AGENT_MODEL = "claude-sonnet-5"     # PINNED — never remove (silent-drift rule)
AGENT_EFFORT = "medium"             # PINNED — never remove (burn rule, m16144)
DEFAULT_PROJECT = "Fleet-Ops"       # bus-project-field-v1 — per-message override via project kwarg

# ATLAS COMMAND status pills — Leo's own topic; .atlas-command.json may override
# either field, "chat_id": null mutes.
ATLAS_COMMAND_CHAT_ID = -1003914182493
LEO_TOPIC_THREAD_ID = 8535

BRIDGE_URL = os.environ.get("LEO_BRIDGE_URL", "http://100.68.232.28:9123")
BUS_POLL_INTERVAL_S = 10

ALLOWED_USER_IDS = {7225949234}     # coxwell ONLY (DM-only agent, v1)
POLL_TIMEOUT_S = 30
CLAUDE_TIMEOUT_S = 1200
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif")

# usage self-halt rails (kit v1.1 shape spec)
HALT_SESSION_PCT = 70
HALT_WEEK_ALL_PCT = 97
# `week_agent_pct` is the MODEL-FAMILY line from `claude /usage`, and that line
# reads "(Fable)" on every distro regardless of which model the agent runs.
# Leo is pinned to claude-sonnet-5 (AGENT_MODEL below), so she spends nothing
# against that family — yet railing on it kept her dark 2026-08-14 -> 08-17 at
# "week-agent 100% >= 75%" while her real caps sat at session 61% / week-all 77%
# (foc14 diagnosis m21987, coxwell-approved fix m21989). Rail on the caps that
# actually govern this agent; keep the family line advisory-only unless the
# pinned model belongs to that family.
HALT_WEEK_AGENT_PCT = 75          # applied ONLY when the family line matches
AGENT_MODEL_FAMILY = "sonnet"     # keep in sync with AGENT_MODEL
FAMILY_LINE_IS_OURS = AGENT_MODEL_FAMILY in ("fable", "opus")

# bus retry rails (added after the 2026-07-30 runaway: 8309 dispatches over
# 117 ids, top ids retried 148x each, 7906 failures).
BUS_MAX_ATTEMPTS = 3                       # then dead-letter, stop retrying
BUS_RETRY_BACKOFF_S = (30, 120, 480)       # ~10 min of grace before giving up
BUS_READ_CAP = 1000                        # dedupe ring size (was 200)
DEAD_LETTER_FILE = WORKSPACE / "logs" / "dead_letter.jsonl"

STATE_LOCK = threading.Lock()
SPAWN_LOCK = threading.Lock()       # serialize spawns (stuck-Iris fix)
_status_stop = threading.Event()

# bus hang guard (2026-08-28 incident: getaddrinfo/connect to the bus can
# block past urlopen's timeout= when the network/route isn't up yet at boot
# -- e.g. Tailscale not attached -- wedging the single bus_loop thread
# forever with no exception ever raised, so the existing try/except never
# fires and the loop goes silent with no log line. Bounding the call from
# OUTSIDE via a worker pool means bus_loop's own while-loop can never block
# longer than BUS_HANG_TIMEOUT_S, independent of what urllib does internally.
BUS_HANG_TIMEOUT_S = 25
BUS_HEARTBEAT_INTERVAL_S = 60
_bus_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="bus-req")

# usage shim — import-guarded: a broken/missing shim must never down the poller
sys.path.insert(0, str(WORKSPACE / "lib"))
try:
    from usage_emit import read_usage, emit_usage_delta  # type: ignore
except Exception:
    read_usage = None
    emit_usage_delta = None


def log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def load_token() -> str:
    if not TOKEN_PATH.exists():
        sys.exit(f"token file missing: {TOKEN_PATH}")
    return TOKEN_PATH.read_text(encoding="utf-8").strip()


def load_state() -> dict:
    try:
        s = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        s = {"offset": 0}
    s.setdefault("session_started", False)
    s.setdefault("bus_read", [])     # dedupe ring of handled bus message ids
    s.setdefault("bus_attempts", {}) # mid -> {n, next_at} in-flight retries
    s.setdefault("bus_last_ts", "")  # high-water mark; older msgs never re-run
    # One-off repair: the pre-fix ring stored duplicates. Collapse them so a
    # restart does not inherit a ring that is mostly copies of one id.
    seen, uniq = set(), []
    for x in s.get("bus_read", []):
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    s["bus_read"] = uniq[-1000:]
    return s


def save_state(state: dict) -> None:
    with STATE_LOCK:
        try:
            tmp = STATE_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(state), encoding="utf-8")
            tmp.replace(STATE_FILE)
        except Exception as e:
            log(f"save_state failed: {e}")


# --- FF.1 status writer -------------------------------------------------------

def write_status(state: str, task=None) -> None:
    try:
        blob = {"state": state, "task": task,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "pid": os.getpid()}
        tmp = STATUS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(blob), encoding="utf-8")
        tmp.replace(STATUS_FILE)
    except Exception as e:
        log(f"write_status failed: {e}")


def _heartbeat(task: str) -> None:
    while not _status_stop.wait(60):
        write_status("WORKING", task)


# --- Telegram plumbing (iris-base, verbatim) ----------------------------------

def tg_request(token: str, method: str, params: dict, timeout: int = 35):
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = json.dumps(params).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = json.loads(r.read())
    if not body.get("ok"):
        raise RuntimeError(f"TG {method} failed: {body}")
    return body.get("result")


def load_atlas_config() -> dict:
    try:
        return json.loads(ATLAS_CONFIG_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except Exception as e:
        log(f"atlas-command.json read error: {e}")
        return {}


def post_status(token: str, event: str, body: str) -> None:
    cfg = load_atlas_config()
    chat_id = cfg.get("chat_id", ATLAS_COMMAND_CHAT_ID)
    thread_id = cfg.get("thread_id", LEO_TOPIC_THREAD_ID)
    if not chat_id:
        return
    text = f"[{event}] {body}"[:3900]
    try:
        params = {"chat_id": chat_id, "text": text}
        if thread_id is not None:
            params["message_thread_id"] = thread_id
        tg_request(token, "sendMessage", params)
    except Exception as e:
        log(f"status post ({event}) failed: {e}")


# --- bus plumbing (fable _req pattern: tolerant of non-JSON responses) --------

def bus_req(method: str, path: str, payload=None, timeout=20):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        BRIDGE_URL + path, data=data, method=method,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read().decode("utf-8", "replace")
    if not body.strip():
        return {}
    try:
        return json.loads(body)
    except ValueError:
        return {"raw": body.strip()}


def bus_req_bounded(method: str, path: str, payload=None, timeout=20):
    """bus_req, but bounded from the OUTSIDE so a resolution/connect hang
    that ignores urlopen's own timeout can never wedge the calling thread
    past BUS_HANG_TIMEOUT_S. The abandoned worker thread is leaked (Python
    cannot force-kill a blocked thread) but is harmless -- it either finishes
    late and its result is discarded, or stays blocked until process exit."""
    fut = _bus_executor.submit(bus_req, method, path, payload, timeout)
    try:
        return fut.result(timeout=BUS_HANG_TIMEOUT_S)
    except FutureTimeoutError:
        raise RuntimeError(f"bus request hung past {BUS_HANG_TIMEOUT_S}s (network/route not ready?)")


# --- usage self-halt ----------------------------------------------------------

def usage_halted() -> str | None:
    """Return a human reason if the usage rails say halt, else None."""
    if read_usage is None:
        return None
    try:
        u = read_usage()
        s = u.get("session_pct")
        wall = u.get("week_all_pct")
        wa = u.get("week_agent_pct")
        if s is not None and s >= HALT_SESSION_PCT:
            return f"session window {s}% >= {HALT_SESSION_PCT}%"
        if wall is not None and wall >= HALT_WEEK_ALL_PCT:
            return f"week-all {wall}% >= {HALT_WEEK_ALL_PCT}%"
        if FAMILY_LINE_IS_OURS and wa is not None and wa >= HALT_WEEK_AGENT_PCT:
            return f"week-agent {wa}% >= {HALT_WEEK_AGENT_PCT}%"
        if wa is not None and wa >= HALT_WEEK_AGENT_PCT:
            # Visible, but NOT a halt: it is another family's budget.
            log(f"usage note: family line {wa}% (not {AGENT_MODEL_FAMILY}) — advisory only")
    except Exception as e:
        log(f"usage check failed (fail-open): {e}")
    return None


# --- inbound attachment download (iris-base, images only) ---------------------

def _download_file(token: str, file_id: str, dest_dir: Path, stem: str) -> Path | None:
    try:
        info = tg_request(token, "getFile", {"file_id": file_id}, timeout=20)
        file_path = info.get("file_path")
        if not file_path:
            return None
        ext = os.path.splitext(file_path)[1] or ".bin"
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{stem}{ext}"
        url = f"https://api.telegram.org/file/bot{token}/{file_path}"
        with urllib.request.urlopen(url, timeout=60) as r:
            dest.write_bytes(r.read())
        return dest
    except Exception as e:
        log(f"download failed for {file_id}: {e}")
        return None


def extract_inbound_images(token: str, msg: dict) -> list:
    saved = []
    msg_id = msg.get("message_id", "x")
    photos = msg.get("photo") or []
    if photos:
        p = _download_file(token, photos[-1]["file_id"], ATTACH_INCOMING, f"{msg_id}_photo")
        if p:
            saved.append(p)
    doc = msg.get("document")
    if doc and str(doc.get("mime_type", "")).startswith("image/"):
        p = _download_file(token, doc["file_id"], ATTACH_INCOMING, f"{msg_id}_doc")
        if p:
            saved.append(p)
    return saved


# --- claude spawn (PINNED model + effort) -------------------------------------

def spawn_claude(prompt: str, continue_session: bool) -> tuple:
    cmd = ["claude", "--print",
           "--model", AGENT_MODEL, "--effort", AGENT_EFFORT,
           "--permission-mode", "acceptEdits"]
    if continue_session:
        cmd.append("--continue")
    try:
        result = subprocess.run(
            cmd, input=prompt, cwd=str(WORKSPACE),
            capture_output=True, encoding="utf-8", errors="replace",
            timeout=CLAUDE_TIMEOUT_S,
        )
        if result.returncode != 0:
            # Claude Code --print writes its error text to STDOUT, not stderr.
            # Reading stderr alone logged an empty reason on all 7906 failures
            # in the 2026-07-30 loop, making the outage undiagnosable.
            err = (result.stderr or "").strip()
            out = (result.stdout or "").strip()
            detail = err or out or "(no output on stderr or stdout)"
            return False, f"claude exit {result.returncode}: {detail[:400]}"
        return True, (result.stdout or "").strip()
    except subprocess.TimeoutExpired:
        return False, f"claude timeout ({CLAUDE_TIMEOUT_S}s)"
    except FileNotFoundError:
        return False, "claude CLI not on PATH"
    except Exception as e:
        return False, f"spawn failed: {e}"


def run_task(prompt: str, task_label: str, continue_session: bool) -> tuple:
    """Spawn wrapper shared by DM + bus paths: status writer + usage emit."""
    write_status("WORKING", task_label)
    hb = threading.Thread(target=_heartbeat, args=(task_label,), daemon=True)
    _status_stop.clear()
    hb.start()
    before = read_usage() if read_usage else None
    t0 = time.time()
    try:
        ok, reply = spawn_claude(prompt, continue_session)
    finally:
        _status_stop.set()
        write_status("IDLE")
    if emit_usage_delta and before is not None:
        try:
            emit_usage_delta(AGENT_ID, task_label, before, read_usage(), t0, time.time())
        except Exception as e:
            log(f"usage emit failed (ignored): {e}")
    return ok, reply, int(time.time() - t0)


# --- typing indicator (iris-base) ---------------------------------------------

def _typing_loop(token: str, chat_id: int, stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        try:
            tg_request(token, "sendChatAction", {"chat_id": chat_id, "action": "typing"}, timeout=5)
        except Exception as e:
            log(f"typing-action fail (continuing): {e}")
        if stop_event.wait(4):
            return


# --- DM handler ---------------------------------------------------------------

def handle_message(token: str, msg: dict, state: dict) -> None:
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    if chat.get("type") != "private":
        log(f"reject non-private chat {chat_id}")
        return
    user_id = (msg.get("from") or {}).get("id")
    if user_id not in ALLOWED_USER_IDS:
        log(f"reject user {user_id}")
        return
    msg_id = msg.get("message_id")
    stop_typing = threading.Event()
    typing_thread = threading.Thread(target=_typing_loop, args=(token, chat_id, stop_typing), daemon=True)
    typing_thread.start()
    try:
        text = (msg.get("text") or msg.get("caption") or "").strip()
        if text.lower() in ("/new", "/reset"):
            with STATE_LOCK:
                state["session_started"] = False
            save_state(state)
            try:
                tg_request(token, "sendMessage", {"chat_id": chat_id, "text": "fresh session — next message starts clean."})
            except Exception as e:
                log(f"reset-ack failed: {e}")
            return
        images = extract_inbound_images(token, msg)
        if not text and not images:
            log(f"skip empty msg {msg_id}")
            return
        halt = usage_halted()
        if halt:
            log(f"msg {msg_id}: usage self-halt ({halt})")
            post_status(token, "BLOCKER", f"usage self-halt: {halt} — declining DMs until window resets")
            try:
                tg_request(token, "sendMessage", {"chat_id": chat_id, "reply_to_message_id": msg_id,
                    "text": f"⏸ usage rail hit ({halt}) — I'll pick this up after the window resets. Resend then."})
            except Exception as e:
                log(f"halt-reply failed: {e}")
            return
        prompt_parts = []
        for p in images:
            prompt_parts.append(f"[Reference image attached at: {p}]")
        prompt_parts.append(text or "(no text — see attached image)")
        prompt = "\n".join(prompt_parts)
        log(f"msg {msg_id}: {text[:60]!r} (+{len(images)} img)")
        if not SPAWN_LOCK.acquire(blocking=False):
            log(f"msg {msg_id}: busy (spawn in flight) — skipping")
            try:
                tg_request(token, "sendMessage", {"chat_id": chat_id, "reply_to_message_id": msg_id,
                    "text": "🔧 Mid-task right now — give me a moment and resend."})
            except Exception as e:
                log(f"busy-reply failed: {e}")
            return
        try:
            ok, reply, dur = run_task(prompt, f"dm-{msg_id}", bool(state.get("session_started")))
        finally:
            SPAWN_LOCK.release()
        if not ok:
            log(f"claude FAILED in {dur}s: {reply}")
            post_status(token, "BLOCKER", f"msg {msg_id} after {dur}s: {reply[:240]}")
            try:
                tg_request(token, "sendMessage", {"chat_id": chat_id, "reply_to_message_id": msg_id,
                                                  "text": f"⚠️ claude error: {reply[:400]}"})
            except Exception as e:
                log(f"error-reply failed: {e}")
            return
        with STATE_LOCK:
            state["session_started"] = True
        save_state(state)
        log(f"claude returned {len(reply)} chars in {dur}s")
        post_status(token, "WAKE_DONE", f"msg {msg_id} → {len(reply)}ch in {dur}s")
        try:
            tg_request(token, "sendMessage", {"chat_id": chat_id, "text": (reply or "(empty reply)")[:3900]})
        except Exception as e:
            log(f"reply send failed: {e}")
    finally:
        stop_typing.set()
        typing_thread.join(timeout=5)


# --- bus-secondary thread -----------------------------------------------------

def _remember_bus_read(state: dict, mid: str) -> None:
    """Record mid in the dedupe ring EXACTLY ONCE.

    The previous code did `state["bus_read"] + [mid]` unconditionally, so a
    message retried N times inserted N copies of the same id and evicted
    *distinct* ids out of the 200-entry ring. Evicted ids then looked unseen
    and were re-dispatched, producing more duplicates -- a feedback loop that
    manufactured its own recycling. Dedupe on insert breaks that.
    """
    with STATE_LOCK:
        ring = [x for x in state.get("bus_read", []) if x != mid]
        ring.append(mid)
        state["bus_read"] = ring[-BUS_READ_CAP:]


def _bus_finish(state: dict, mid: str, ts: str) -> None:
    """Mark a message finished: out of the retry map, into the dedupe ring,
    and advance the high-water mark so it can never be reconsidered even if
    the ring later rolls over."""
    with STATE_LOCK:
        state.get("bus_attempts", {}).pop(mid, None)
        if ts and ts > str(state.get("bus_last_ts") or ""):
            state["bus_last_ts"] = ts
    _remember_bus_read(state, mid)


def _dead_letter(state: dict, m: dict, reason: str, attempts: int) -> None:
    """Park a message that failed BUS_MAX_ATTEMPTS times. Written to a local
    JSONL file, deliberately NOT re-posted to the bus -- a dead-letter path
    that posts would recreate the noise storm it exists to stop."""
    rec = {
        "dead_lettered_at": datetime.now(timezone.utc).isoformat(),
        "id": m.get("id"), "from": m.get("from"), "ts": m.get("ts"),
        "thread_id": m.get("thread_id"), "attempts": attempts,
        "last_error": reason[:500], "body": str(m.get("body", ""))[:2000],
    }
    try:
        DEAD_LETTER_FILE.parent.mkdir(parents=True, exist_ok=True)
        with DEAD_LETTER_FILE.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception as e:
        log(f"dead-letter write failed for {m.get('id')}: {e}")


def bus_loop(token: str, state: dict) -> None:
    """Poll /messages?for=leo; handle each unseen message via the same spawn
    path; reply on-bus. Read-marking AFTER handling (fable pattern)."""
    log(f"bus-secondary online — {BRIDGE_URL}/messages?for={AGENT_ID}")
    last_hb = time.time()
    while True:
        now = time.time()
        if now - last_hb >= BUS_HEARTBEAT_INTERVAL_S:
            log("bus loop heartbeat (alive)")
            last_hb = now
        try:
            resp = bus_req_bounded("GET", f"/messages?for={AGENT_ID}")
            msgs = resp.get("messages", []) if isinstance(resp, dict) else []
            for m in msgs:
                mid = m.get("id")
                if not mid:
                    continue
                mts = str(m.get("ts") or "")
                with STATE_LOCK:
                    if mid in state.get("bus_read", []):
                        continue
                    att = dict(state.get("bus_attempts", {}).get(mid) or {})
                    hwm = str(state.get("bus_last_ts") or "")
                # Below the high-water mark and not mid-retry => already
                # finished in an earlier life; never reconsider it.
                if not att and hwm and mts and mts <= hwm:
                    _remember_bus_read(state, mid)
                    continue
                # Mid-retry but backoff has not elapsed yet.
                if att and time.time() < float(att.get("next_at") or 0):
                    continue
                if str(m.get("from", "")).lower() == AGENT_ID:
                    _bus_finish(state, mid, mts)
                    save_state(state)
                    continue
                halt = usage_halted()
                if halt:
                    log(f"bus {mid}: usage self-halt ({halt}) — leaving unread, recheck in 600s")
                    time.sleep(600)
                    break
                if not SPAWN_LOCK.acquire(blocking=False):
                    break  # busy — message stays unhandled, next cycle retries
                try:
                    body = str(m.get("body", ""))
                    sender = m.get("from", "?")
                    prompt = (f"[Bus message from {sender}"
                              f"{' thread ' + m['thread_id'] if m.get('thread_id') else ''}] {body}")
                    log(f"bus {mid} from {sender}: {body[:60]!r}")
                    ok, reply, dur = run_task(prompt, f"bus-{mid}", False)
                finally:
                    SPAWN_LOCK.release()
                if ok:
                    log(f"bus {mid} handled in {dur}s ({len(reply)} chars)")
                    reply_payload = {
                        "from": AGENT_ID, "to": m.get("from"),
                        "room": m.get("room"), "thread_id": m.get("thread_id"),
                        "body": reply[:8000],
                    }
                    # bus-project-field-v1: inherit incoming message's project
                    # (per-message override) else fall back to our default;
                    # omit entirely if neither is set, per spec.
                    project = m.get("project") or DEFAULT_PROJECT
                    if project:
                        reply_payload["project"] = str(project)[:64]
                    bus_req_bounded("POST", "/message", reply_payload)
                    _bus_finish(state, mid, mts)
                    try:
                        bus_req_bounded("POST", f"/message/{mid}/read", {"by": AGENT_ID})
                    except Exception as e:
                        log(f"bus read-mark failed for {mid}: {e}")
                    save_state(state)
                    continue

                # ---- failure: retry with backoff, then dead-letter ----
                n = int(att.get("n") or 0) + 1
                log(f"bus {mid} FAILED in {dur}s (attempt {n}/{BUS_MAX_ATTEMPTS}): {reply[:200]}")
                if n < BUS_MAX_ATTEMPTS:
                    delay = BUS_RETRY_BACKOFF_S[min(n - 1, len(BUS_RETRY_BACKOFF_S) - 1)]
                    with STATE_LOCK:
                        state.setdefault("bus_attempts", {})[mid] = {
                            "n": n, "next_at": time.time() + delay,
                        }
                    log(f"bus {mid} retry in {delay}s")
                    save_state(state)
                    continue
                # Ceiling reached: park it, ack it, and say so exactly once.
                # Acking matters -- an un-acked dead letter is redelivered
                # forever and the ceiling would achieve nothing.
                _dead_letter(state, m, reply, n)
                log(f"bus {mid} DEAD-LETTERED after {n} attempts -> {DEAD_LETTER_FILE}")
                post_status(token, "BLOCKER",
                            f"bus {mid} dead-lettered after {n} attempts: {reply[:200]}")
                try:
                    bus_req_bounded("POST", f"/message/{mid}/read", {"by": AGENT_ID})
                except Exception as e:
                    log(f"bus read-mark failed for {mid}: {e}")
                _bus_finish(state, mid, mts)
                save_state(state)
        except Exception as e:
            log(f"bus loop error: {e}; retry in 15s")
            time.sleep(15)
        time.sleep(BUS_POLL_INTERVAL_S)


def bus_loop_supervised(token: str, state: dict) -> None:
    """Restart bus_loop if it ever returns or dies. bus_loop already catches
    Exception internally, so this only fires on something that slips past
    that (e.g. a BaseException) -- belt-and-suspenders so a dead bus thread
    is never silently permanent."""
    while True:
        try:
            bus_loop(token, state)
            log("bus loop returned unexpectedly -- restarting in 5s")
        except Exception as e:
            log(f"bus loop crashed: {e} -- restarting in 5s")
        time.sleep(5)


# --- main ---------------------------------------------------------------------

def main() -> None:
    token = load_token()
    state = load_state()
    ATTACH_INCOMING.mkdir(parents=True, exist_ok=True)
    write_status("IDLE")
    try:
        me = tg_request(token, "getMe", {})
        log(f"Leo online — bot @{me.get('username')} (id={me.get('id')})")
    except Exception as e:
        sys.exit(f"getMe failed: {e}")
    post_status(token, "RESTART", f"Leo poller online @ {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    threading.Thread(target=bus_loop_supervised, args=(token, state), name="bus-loop", daemon=True).start()
    while True:
        try:
            updates = tg_request(token, "getUpdates", {
                "offset": state.get("offset", 0),
                "timeout": POLL_TIMEOUT_S,
                "allowed_updates": ["message"],
            }, timeout=POLL_TIMEOUT_S + 5)
            for upd in updates:
                try:
                    if upd.get("message"):
                        threading.Thread(
                            target=handle_message, args=(token, upd["message"], state),
                            name=f"handler-{upd['update_id']}", daemon=True,
                        ).start()
                finally:
                    with STATE_LOCK:
                        state["offset"] = upd["update_id"] + 1
                    save_state(state)
        except urllib.error.URLError as e:
            log(f"poll URL error: {e}; retry in 5s")
            time.sleep(5)
        except Exception as e:
            log(f"poll loop error: {e}; retry in 5s")
            time.sleep(5)


if __name__ == "__main__":
    main()
