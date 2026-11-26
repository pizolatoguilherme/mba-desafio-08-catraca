-- 001_init: schema completo da Catraca (docs/architecture.md §3).
-- As constraints CHECK/UNIQUE são inline, para que o Postgres gere nomes previsíveis
-- (events_capacity_check, events_price_cents_check, events_status_check,
--  tickets_status_check, tickets_price_cents_check, tickets_code_key).

CREATE TABLE users (
  id            text PRIMARY KEY,                       -- usr_xxxxxxxxxx
  name          text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL,                          -- scrypt$<salt hex>$<hash hex>
  role          text NOT NULL CHECK (role IN ('participant','organizer')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TABLE sessions (
  id         text PRIMARY KEY,                          -- 32 bytes random base64url
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id           text PRIMARY KEY,                        -- evt_xxxxxxxxxx
  organizer_id text NOT NULL REFERENCES users(id),
  name         text NOT NULL CHECK (length(trim(name)) > 0),
  venue        text NOT NULL CHECK (length(trim(venue)) > 0),
  starts_at    timestamptz NOT NULL,
  capacity     integer NOT NULL CHECK (capacity >= 1),
  price_cents  integer NOT NULL CHECK (price_cents > 0),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  cancelled_at timestamptz
);
CREATE INDEX events_organizer_idx ON events (organizer_id);
CREATE INDEX events_status_idx ON events (status);

CREATE TABLE tickets (
  id            text PRIMARY KEY,                       -- tkt_xxxxxxxxxx
  event_id      text NOT NULL REFERENCES events(id),
  user_id       text REFERENCES users(id),              -- null para canal partner
  buyer_email   text NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('web','partner')),
  code          text NOT NULL UNIQUE,                   -- 8 chars [A-Z2-9]
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','confirmed','declined','cancelled','refunded')),
  price_cents   integer NOT NULL CHECK (price_cents > 0), -- preço vigente na compra
  card_last4    text NOT NULL CHECK (card_last4 ~ '^[0-9]{4}$'),
  checked_in_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_event_status_idx ON tickets (event_id, status);
CREATE INDEX tickets_user_idx ON tickets (user_id);

CREATE TABLE payments (
  id           bigserial PRIMARY KEY,
  ticket_id    text NOT NULL UNIQUE REFERENCES tickets(id),
  card_last4   text NOT NULL,
  state        text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','in_flight','done')),
  result       text CHECK (result IN ('approved','declined')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  completed_at timestamptz
);
CREATE INDEX payments_state_idx ON payments (state);
