CREATE TABLE IF NOT EXISTS billing_plans (
 id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS billing_members (
 user_id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, registered_at TEXT NOT NULL,
 plan_id TEXT NOT NULL DEFAULT 'free', status TEXT NOT NULL DEFAULT 'active', period TEXT NOT NULL DEFAULT 'monthly',
 starts_at TEXT, ends_at TEXT, cancel_at_end INTEGER NOT NULL DEFAULT 0, auto_renew INTEGER NOT NULL DEFAULT 0,
 parent_order_id TEXT, last_payment_id TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_payments (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan_id TEXT NOT NULL, period TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount > 0), currency TEXT NOT NULL DEFAULT 'GEL',
 status TEXT NOT NULL DEFAULT 'pending', provider_order_id TEXT UNIQUE, redirect_url TEXT,
 idempotency_key TEXT NOT NULL, consent INTEGER NOT NULL DEFAULT 0, renewal INTEGER NOT NULL DEFAULT 0,
 base_ends_at TEXT, applied_at TEXT, refunded_amount INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS billing_payments_user ON billing_payments(user_id,created_at);
CREATE TABLE IF NOT EXISTS billing_usage (
 user_id TEXT NOT NULL, day TEXT NOT NULL, feature TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,day,feature), CHECK(amount >= 0)
);
CREATE INDEX IF NOT EXISTS billing_usage_day ON billing_usage(day,feature);
CREATE TABLE IF NOT EXISTS billing_activity (
 user_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(user_id,day)
);
CREATE INDEX IF NOT EXISTS billing_activity_day ON billing_activity(day);
CREATE TABLE IF NOT EXISTS billing_events (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_events_time ON billing_events(created_at,kind);
CREATE TABLE IF NOT EXISTS billing_consultations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, topic TEXT NOT NULL, preferred_at TEXT, status TEXT NOT NULL DEFAULT 'requested',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, request_key TEXT NOT NULL, UNIQUE(user_id,request_key)
);
CREATE INDEX IF NOT EXISTS billing_consultations_time ON billing_consultations(created_at);
CREATE TABLE IF NOT EXISTS billing_refunds (
 id TEXT PRIMARY KEY, payment_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0),
 status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL, actor_id TEXT NOT NULL,
 provider_action_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
