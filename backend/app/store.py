"""Storage layer: Redis in production, a plain in-memory store when REDIS_URL is not set.

Key layout (same for both backends):
  lead:{id}           -> lead JSON              set "leads" -> all lead ids
  call:{id}           -> finished call JSON     list "calls" -> call ids, newest first
  session:{call_id}   -> live call state (expires after 2 hours)
  slot:{date}T{time}  -> lead id that booked it (SETNX = no double booking)
  bookings            -> list of booking JSON, newest first
"""
import json
import logging
import threading
import time

from . import config

log = logging.getLogger(__name__)
SESSION_TTL = 2 * 60 * 60


class MemoryKV:
    """Tiny subset of Redis commands, kept in a Python dict. Used locally or if Redis is down."""

    def __init__(self):
        self.data, self.expiry, self.lock = {}, {}, threading.Lock()

    def _alive(self, key):
        exp = self.expiry.get(key)
        if exp and exp < time.time():
            self.data.pop(key, None)
            self.expiry.pop(key, None)
        return key in self.data

    def get(self, key):
        with self.lock:
            return self.data.get(key) if self._alive(key) else None

    def set(self, key, value, ex=None, nx=False):
        with self.lock:
            if nx and self._alive(key):
                return False
            self.data[key] = value
            if ex:
                self.expiry[key] = time.time() + ex
            return True

    def delete(self, key):
        with self.lock:
            self.data.pop(key, None)

    def sadd(self, key, member):
        with self.lock:
            self.data.setdefault(key, set()).add(member)

    def smembers(self, key):
        with self.lock:
            return set(self.data.get(key, set()))

    def lpush(self, key, value):
        with self.lock:
            self.data.setdefault(key, []).insert(0, value)

    def lrange(self, key, start, end):
        with self.lock:
            items = self.data.get(key, [])
            return items[start:] if end == -1 else items[start:end + 1]

    def ping(self):
        return True


def _connect():
    if config.REDIS_URL:
        try:
            import redis

            client = redis.Redis.from_url(config.REDIS_URL, decode_responses=True, socket_timeout=5)
            client.ping()
            log.info("Storage: Redis")
            return client, "redis"
        except Exception as exc:  # noqa: BLE001
            log.warning("Redis unavailable (%s). Falling back to in-memory storage.", exc)
    log.info("Storage: in-memory")
    return MemoryKV(), "memory"


kv, BACKEND = _connect()


def _load(raw):
    return json.loads(raw) if raw else None


# ---------- Leads ----------
def save_lead(lead: dict) -> dict:
    kv.set(f"lead:{lead['id']}", json.dumps(lead))
    kv.sadd("leads", lead["id"])
    return lead


def get_lead(lead_id: str):
    return _load(kv.get(f"lead:{lead_id}")) if lead_id else None


def list_leads() -> list:
    leads = [get_lead(i) for i in kv.smembers("leads")]
    return sorted([l for l in leads if l], key=lambda l: l.get("updated_at", ""), reverse=True)


# ---------- Live call sessions ----------
def save_session(session: dict):
    kv.set(f"session:{session['call_id']}", json.dumps(session), ex=SESSION_TTL)


def get_session(call_id: str):
    return _load(kv.get(f"session:{call_id}"))


def delete_session(call_id: str):
    kv.delete(f"session:{call_id}")


# ---------- Finished calls ----------
def save_call(call: dict):
    kv.set(f"call:{call['id']}", json.dumps(call))
    kv.lpush("calls", call["id"])


def get_call(call_id: str):
    return _load(kv.get(f"call:{call_id}"))


def list_calls(limit: int = 100) -> list:
    return [c for c in (get_call(i) for i in kv.lrange("calls", 0, limit - 1)) if c]


# ---------- Survey bookings ----------
def is_slot_taken(date: str, time_: str) -> bool:
    return kv.get(f"slot:{date}T{time_}") is not None


def reserve_slot(date: str, time_: str, lead_id: str) -> bool:
    """Atomic: returns False if someone else already booked this slot."""
    return bool(kv.set(f"slot:{date}T{time_}", lead_id, nx=True))


def add_booking(booking: dict):
    kv.lpush("bookings", json.dumps(booking))


def list_bookings(limit: int = 100) -> list:
    return [json.loads(b) for b in kv.lrange("bookings", 0, limit - 1)]
