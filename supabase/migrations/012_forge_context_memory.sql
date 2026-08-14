-- 012_forge_context_memory.sql
-- Durable conversation memory (context-memory pass).
-- ADDITIVE: extends orgforge.chat_sessions with the agent's bounded verbatim
-- transcript plus the flash-compressed summary of older turns, so a session's
-- conversation survives process restarts, manager eviction (4h Redis TTL), and
-- multi-instance routing — and can never be read outside its (user, org,
-- session) key, which the existing RLS policy already enforces.
--
-- `transcript`      JSONB array of bounded turns [{role, text, ts}] — text-only
--                   (images/tool payloads excluded for size), newest last.
-- `context_summary` TEXT — compact flash summary of the older turns (nullable;
--                   mirrors the live chat's compression state).
-- Idempotent: safe to run multiple times.

ALTER TABLE orgforge.chat_sessions
    ADD COLUMN IF NOT EXISTS transcript JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS context_summary TEXT;
