-- ============================================================
-- GOBOKI — PostgreSQL Schema (Multi-Tenant)
-- Each tenant (business) has fully isolated data via tenant_id
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- fuzzy search

-- ────────────────────────────────────────────────────────────
-- TENANTS (each = one travel business / workspace)
-- ────────────────────────────────────────────────────────────
CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(255)    NOT NULL,
  slug            VARCHAR(100)    NOT NULL UNIQUE, -- goboki.com/book/{slug}
  plan            VARCHAR(20)     NOT NULL DEFAULT 'starter'
                  CHECK (plan IN ('starter','pro','enterprise')),
  plan_expires_at TIMESTAMPTZ,
  stripe_customer_id VARCHAR(100),
  settings        JSONB           NOT NULL DEFAULT '{}',
  -- {primaryColor, logo, timezone, currency, language}
  is_active       BOOLEAN         NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);

-- ────────────────────────────────────────────────────────────
-- USERS (staff & admins per tenant)
-- ────────────────────────────────────────────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email           VARCHAR(255) NOT NULL,
  password_hash   VARCHAR(255),                -- null for OAuth-only users
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'staff'
                  CHECK (role IN ('owner','admin','staff','super_admin')),
  avatar_url      TEXT,
  google_id       VARCHAR(100),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email  ON users(email);

-- ────────────────────────────────────────────────────────────
-- EXPERIENCES (products: tours, retreats, rooms, packages)
-- ────────────────────────────────────────────────────────────
CREATE TABLE experiences (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(150) NOT NULL,
  type            VARCHAR(30)  NOT NULL
                  CHECK (type IN ('retreat','tour','package','room','activity','camp')),
  description     TEXT,
  short_desc      VARCHAR(500),
  images          JSONB        NOT NULL DEFAULT '[]',
  base_price      NUMERIC(10,2) NOT NULL,
  currency        CHAR(3)      NOT NULL DEFAULT 'USD',
  duration_days   INTEGER,
  max_capacity    INTEGER      NOT NULL DEFAULT 10,
  min_guests      INTEGER      NOT NULL DEFAULT 1,
  max_guests      INTEGER      NOT NULL DEFAULT 10,
  location        JSONB,       -- {country, city, coordinates}
  inclusions      JSONB        NOT NULL DEFAULT '[]',
  exclusions      JSONB        NOT NULL DEFAULT '[]',
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  seo_title       VARCHAR(255),
  seo_description VARCHAR(500),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

CREATE INDEX idx_experiences_tenant ON experiences(tenant_id);
CREATE INDEX idx_experiences_type   ON experiences(tenant_id, type);

-- ────────────────────────────────────────────────────────────
-- PRICING RULES (seasonal, per-person, add-ons)
-- ────────────────────────────────────────────────────────────
CREATE TABLE pricing_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experience_id   UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  type            VARCHAR(30)  NOT NULL
                  CHECK (type IN ('base','seasonal','group','early_bird','addon')),
  price_modifier  NUMERIC(10,2),  -- absolute price OR...
  percent_modifier NUMERIC(5,2),  -- ...percent change
  modifier_op     VARCHAR(10)  NOT NULL DEFAULT 'replace'
                  CHECK (modifier_op IN ('replace','add','subtract','multiply')),
  valid_from      DATE,
  valid_to        DATE,
  min_guests      INTEGER,
  max_guests      INTEGER,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pricing_experience ON pricing_rules(experience_id);

-- ────────────────────────────────────────────────────────────
-- AVAILABILITY (blocked dates / capacity overrides)
-- ────────────────────────────────────────────────────────────
CREATE TABLE availability (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  experience_id   UUID NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  capacity        INTEGER,        -- null = use experience default
  is_blocked      BOOLEAN NOT NULL DEFAULT false,
  block_reason    VARCHAR(255),
  UNIQUE(experience_id, date)
);

CREATE INDEX idx_availability_exp_date ON availability(experience_id, date);

-- ────────────────────────────────────────────────────────────
-- CUSTOMERS (CRM)
-- ────────────────────────────────────────────────────────────
CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email           VARCHAR(255) NOT NULL,
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  phone           VARCHAR(30),
  nationality     CHAR(2),        -- ISO 3166-1 alpha-2
  date_of_birth   DATE,
  passport_number VARCHAR(50),
  dietary_notes   TEXT,
  medical_notes   TEXT,
  tags            TEXT[]          NOT NULL DEFAULT '{}',
  notes           TEXT,
  source          VARCHAR(50),    -- 'direct','referral','google','instagram',...
  total_bookings  INTEGER         NOT NULL DEFAULT 0,
  total_spent     NUMERIC(12,2)   NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_customers_email  ON customers(tenant_id, email);
CREATE INDEX idx_customers_tags   ON customers USING GIN(tags);
CREATE INDEX idx_customers_name   ON customers USING GIN(
  (first_name || ' ' || last_name) gin_trgm_ops
);

-- ────────────────────────────────────────────────────────────
-- BOOKINGS
-- ────────────────────────────────────────────────────────────
CREATE TABLE bookings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference       VARCHAR(20)  NOT NULL UNIQUE, -- e.g. BK-2025-1024
  customer_id     UUID NOT NULL REFERENCES customers(id),
  experience_id   UUID NOT NULL REFERENCES experiences(id),
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending'
                  CHECK (status IN (
                    'pending','confirmed','deposit_paid',
                    'fully_paid','cancelled','refunded','completed','no_show'
                  )),
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  guests          INTEGER NOT NULL DEFAULT 1,
  adults          INTEGER NOT NULL DEFAULT 1,
  children        INTEGER NOT NULL DEFAULT 0,
  base_amount     NUMERIC(10,2) NOT NULL,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(10,2) NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  paid_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
  balance_due     NUMERIC(10,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  deposit_percent INTEGER DEFAULT 30,
  deposit_due_date DATE,
  balance_due_date DATE,
  special_requests TEXT,
  internal_notes  TEXT,
  source          VARCHAR(50) DEFAULT 'direct',  -- 'widget','admin','api'
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  refund_amount   NUMERIC(10,2),
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bookings_tenant     ON bookings(tenant_id);
CREATE INDEX idx_bookings_customer   ON bookings(customer_id);
CREATE INDEX idx_bookings_experience ON bookings(experience_id);
CREATE INDEX idx_bookings_dates      ON bookings(tenant_id, start_date, end_date);
CREATE INDEX idx_bookings_status     ON bookings(tenant_id, status);
CREATE INDEX idx_bookings_reference  ON bookings(reference);

-- Booking guests / participants
CREATE TABLE booking_guests (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  first_name  VARCHAR(100) NOT NULL,
  last_name   VARCHAR(100) NOT NULL,
  email       VARCHAR(255),
  phone       VARCHAR(30),
  age_group   VARCHAR(10) DEFAULT 'adult' CHECK (age_group IN ('adult','child','infant')),
  passport    VARCHAR(50),
  dietary     TEXT,
  medical     TEXT
);

CREATE INDEX idx_booking_guests_booking ON booking_guests(booking_id);

-- Booking add-ons
CREATE TABLE booking_addons (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_price      NUMERIC(10,2) NOT NULL,
  total_price     NUMERIC(10,2) NOT NULL
);

-- ────────────────────────────────────────────────────────────
-- PAYMENTS
-- ────────────────────────────────────────────────────────────
CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id          UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  customer_id         UUID NOT NULL REFERENCES customers(id),
  type                VARCHAR(20) NOT NULL DEFAULT 'charge'
                      CHECK (type IN ('charge','refund','partial_refund','deposit')),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','processing','succeeded','failed','cancelled')),
  amount              NUMERIC(10,2) NOT NULL,
  currency            CHAR(3) NOT NULL DEFAULT 'USD',
  provider            VARCHAR(20) NOT NULL
                      CHECK (provider IN ('stripe','paypal','manual','bank_transfer')),
  provider_payment_id VARCHAR(200),   -- Stripe PaymentIntent ID / PayPal order ID
  provider_ref        VARCHAR(200),   -- charge_id, capture_id
  payment_method      JSONB,          -- {brand, last4, exp_month, exp_year}
  receipt_url         TEXT,
  failure_reason      TEXT,
  metadata            JSONB DEFAULT '{}',
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_tenant  ON payments(tenant_id);
CREATE INDEX idx_payments_booking ON payments(booking_id);

-- ────────────────────────────────────────────────────────────
-- INVOICES
-- ────────────────────────────────────────────────────────────
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id      UUID NOT NULL REFERENCES bookings(id),
  customer_id     UUID NOT NULL REFERENCES customers(id),
  number          VARCHAR(30) NOT NULL UNIQUE,   -- INV-2025-1024
  status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','paid','overdue','void')),
  issued_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE NOT NULL,
  subtotal        NUMERIC(10,2) NOT NULL,
  tax_rate        NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount        NUMERIC(10,2) NOT NULL DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  notes           TEXT,
  pdf_url         TEXT,
  sent_at         TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- EMAIL TEMPLATES & AUTOMATION
-- ────────────────────────────────────────────────────────────
CREATE TABLE email_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  trigger     VARCHAR(50) NOT NULL
              CHECK (trigger IN (
                'booking_confirmed','booking_cancelled','payment_received',
                'deposit_reminder','balance_reminder','pre_arrival',
                'post_stay','review_request','custom'
              )),
  subject     VARCHAR(255) NOT NULL,
  body_html   TEXT NOT NULL,
  body_text   TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  delay_hours INTEGER NOT NULL DEFAULT 0,  -- delay after trigger
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE email_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id  UUID REFERENCES bookings(id),
  customer_id UUID REFERENCES customers(id),
  template_id UUID REFERENCES email_templates(id),
  to_email    VARCHAR(255) NOT NULL,
  subject     VARCHAR(255) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued','sent','delivered','opened','bounced','failed')),
  provider_id VARCHAR(200),
  sent_at     TIMESTAMPTZ,
  opened_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- WEBSITE PAGES (Website Builder)
-- ────────────────────────────────────────────────────────────
CREATE TABLE website_pages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug        VARCHAR(150) NOT NULL,
  title       VARCHAR(255) NOT NULL,
  template    VARCHAR(50) NOT NULL DEFAULT 'blank',
  content     JSONB NOT NULL DEFAULT '{}',  -- block-based editor content
  seo_title   VARCHAR(255),
  seo_desc    VARCHAR(500),
  og_image    TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

-- ────────────────────────────────────────────────────────────
-- WEBHOOKS (Zapier / custom integrations)
-- ────────────────────────────────────────────────────────────
CREATE TABLE webhooks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  events      TEXT[] NOT NULL DEFAULT '{}',
  secret      VARCHAR(100) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  last_fired  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- REFRESH TOKENS
-- ────────────────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  ip_address  INET,
  user_agent  TEXT,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- AUDIT LOG
-- ────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50)  NOT NULL,
  entity_id   UUID,
  old_values  JSONB,
  new_values  JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- Utility: auto-update updated_at
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON experiences
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON website_pages
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
