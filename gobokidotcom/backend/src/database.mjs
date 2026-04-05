// ============================================================
// GOBOKI — In-Memory Database (no Postgres needed)
// Mirrors the PostgreSQL schema exactly
// ============================================================
import crypto from 'crypto';

export function uuid() { return crypto.randomUUID(); }
export function now() { return new Date().toISOString(); }

// ── Generic table store ───────────────────────────────────────
class Table {
  #rows = new Map();

  insert(row) {
    const r = { ...row, id: row.id ?? uuid(), created_at: now(), updated_at: now() };
    this.#rows.set(r.id, r);
    return r;
  }

  update(id, patch) {
    const r = this.#rows.get(id);
    if (!r) return null;
    const updated = { ...r, ...patch, updated_at: now() };
    this.#rows.set(id, updated);
    return updated;
  }

  delete(id) { return this.#rows.delete(id); }

  findById(id) { return this.#rows.get(id) ?? null; }

  find(predicate = () => true) {
    return [...this.#rows.values()].filter(predicate);
  }

  findOne(predicate) {
    return [...this.#rows.values()].find(predicate) ?? null;
  }

  count(predicate = () => true) {
    return [...this.#rows.values()].filter(predicate).length;
  }

  all() { return [...this.#rows.values()]; }
  clear() { this.#rows.clear(); }
}

// ── Database ─────────────────────────────────────────────────
export const db = {
  tenants:         new Table(),
  users:           new Table(),
  experiences:     new Table(),
  pricing_rules:   new Table(),
  availability:    new Table(),
  customers:       new Table(),
  bookings:        new Table(),
  booking_guests:  new Table(),
  booking_addons:  new Table(),
  payments:        new Table(),
  invoices:        new Table(),
  email_templates: new Table(),
  email_logs:      new Table(),
  website_pages:   new Table(),
  webhooks:        new Table(),
  refresh_tokens:  new Table(),
  audit_logs:      new Table(),
};

// ── Seed demo data ────────────────────────────────────────────
export function seedDatabase() {
  db.tenants.clear(); db.users.clear(); db.experiences.clear();
  db.customers.clear(); db.bookings.clear(); db.payments.clear();

  const tenant = db.tenants.insert({
    id: 'tenant-001',
    name: 'Blue Horizon Retreats',
    slug: 'blue-horizon',
    plan: 'pro',
    settings: {
      primaryColor: '#0d9f80',
      timezone: 'Europe/Lisbon',
      currency: 'USD',
      language: 'en',
      depositPercent: 30,
    },
    is_active: true,
  });

  const owner = db.users.insert({
    id: 'user-001',
    tenant_id: tenant.id,
    email: 'jordan@bluehorizon.com',
    first_name: 'Jordan',
    last_name: 'Davies',
    role: 'owner',
    is_active: true,
  });

  const exp1 = db.experiences.insert({
    id: 'exp-001',
    tenant_id: tenant.id,
    name: '7-Day Surf Retreat',
    slug: '7-day-surf-retreat',
    type: 'retreat',
    description: 'Immersive surf retreat in Taghazout, Morocco.',
    base_price: 1420.00,
    currency: 'USD',
    duration_days: 7,
    max_capacity: 12,
    min_guests: 1,
    max_guests: 12,
    location: { country: 'MA', city: 'Taghazout', coordinates: { lat: 30.53, lng: -9.71 } },
    inclusions: ['3 surf sessions/day', 'Accommodation', 'Breakfast & dinner'],
    exclusions: ['Flights', 'Travel insurance'],
    is_active: true,
  });

  const exp2 = db.experiences.insert({
    id: 'exp-002',
    tenant_id: tenant.id,
    name: 'Dive Master Package',
    slug: 'dive-master-package',
    type: 'package',
    description: 'PADI Divemaster course in Dahab, Egypt.',
    base_price: 1300.00,
    currency: 'USD',
    duration_days: 8,
    max_capacity: 8,
    min_guests: 1,
    max_guests: 8,
    location: { country: 'EG', city: 'Dahab', coordinates: { lat: 28.48, lng: 34.51 } },
    inclusions: ['PADI certification', 'All dives', 'Equipment', 'Accommodation'],
    exclusions: ['Flights'],
    is_active: true,
  });

  const exp3 = db.experiences.insert({
    id: 'exp-003',
    tenant_id: tenant.id,
    name: 'Yoga & Meditation Camp',
    slug: 'yoga-meditation-camp',
    type: 'retreat',
    description: 'Transformative 7-day yoga retreat in Ubud, Bali.',
    base_price: 1450.00,
    currency: 'USD',
    duration_days: 7,
    max_capacity: 16,
    min_guests: 1,
    max_guests: 16,
    location: { country: 'ID', city: 'Ubud', coordinates: { lat: -8.50, lng: 115.26 } },
    inclusions: ['Daily yoga', 'Meditation sessions', 'Organic meals', 'Accommodation'],
    exclusions: ['Flights', 'Visa'],
    is_active: true,
  });

  // Pricing rules
  db.pricing_rules.insert({
    experience_id: exp1.id,
    tenant_id: tenant.id,
    name: 'Summer Peak',
    type: 'seasonal',
    price_modifier: 1650,
    modifier_op: 'replace',
    valid_from: '2025-07-01',
    valid_to: '2025-08-31',
    is_active: true,
  });

  db.pricing_rules.insert({
    experience_id: exp1.id,
    tenant_id: tenant.id,
    name: 'Group Discount (4+)',
    type: 'group',
    price_modifier: 120,
    modifier_op: 'subtract',
    min_guests: 4,
    is_active: true,
  });

  // Customers
  const c1 = db.customers.insert({
    id: 'cust-001',
    tenant_id: tenant.id,
    email: 'amira@surf-life.com',
    first_name: 'Amira',
    last_name: 'Mansouri',
    phone: '+212 661 234 567',
    nationality: 'MA',
    tags: ['vip', 'surf', 'repeat'],
    source: 'instagram',
    total_bookings: 3,
    total_spent: 5400,
  });

  const c2 = db.customers.insert({
    id: 'cust-002',
    tenant_id: tenant.id,
    email: 'tomas@diveworld.cz',
    first_name: 'Tomás',
    last_name: 'Krejčí',
    phone: '+420 775 123 456',
    nationality: 'CZ',
    tags: ['group', 'diving'],
    source: 'direct',
    total_bookings: 1,
    total_spent: 0,
  });

  const c3 = db.customers.insert({
    id: 'cust-003',
    tenant_id: tenant.id,
    email: 'sofia.l@wellness.fr',
    first_name: 'Sofia',
    last_name: 'Laurent',
    nationality: 'FR',
    tags: ['solo', 'yoga'],
    source: 'google',
    total_bookings: 0,
    total_spent: 0,
  });

  // Bookings
  const bk1 = db.bookings.insert({
    id: 'bk-001',
    tenant_id: tenant.id,
    reference: 'BK-2025-0001',
    customer_id: c1.id,
    experience_id: exp1.id,
    status: 'confirmed',
    start_date: '2025-08-12',
    end_date: '2025-08-19',
    guests: 2,
    adults: 2,
    children: 0,
    base_amount: 2840,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 2840,
    paid_amount: 852,
    currency: 'USD',
    deposit_percent: 30,
    balance_due_date: '2025-07-12',
    source: 'widget',
  });

  const bk2 = db.bookings.insert({
    id: 'bk-002',
    tenant_id: tenant.id,
    reference: 'BK-2025-0002',
    customer_id: c2.id,
    experience_id: exp2.id,
    status: 'pending',
    start_date: '2025-08-15',
    end_date: '2025-08-23',
    guests: 4,
    adults: 4,
    children: 0,
    base_amount: 5200,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 5200,
    paid_amount: 0,
    currency: 'USD',
    deposit_percent: 30,
    source: 'direct',
  });

  const bk3 = db.bookings.insert({
    id: 'bk-003',
    tenant_id: tenant.id,
    reference: 'BK-2025-0003',
    customer_id: c3.id,
    experience_id: exp3.id,
    status: 'deposit_paid',
    start_date: '2025-09-03',
    end_date: '2025-09-10',
    guests: 1,
    adults: 1,
    children: 0,
    base_amount: 1450,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 1450,
    paid_amount: 435,
    currency: 'USD',
    deposit_percent: 30,
    balance_due_date: '2025-08-03',
    source: 'widget',
  });

  // Payments
  db.payments.insert({
    tenant_id: tenant.id,
    booking_id: bk1.id,
    customer_id: c1.id,
    type: 'deposit',
    status: 'succeeded',
    amount: 852,
    currency: 'USD',
    provider: 'stripe',
    provider_payment_id: 'pi_test_001',
    processed_at: now(),
  });

  db.payments.insert({
    tenant_id: tenant.id,
    booking_id: bk3.id,
    customer_id: c3.id,
    type: 'deposit',
    status: 'succeeded',
    amount: 435,
    currency: 'USD',
    provider: 'stripe',
    provider_payment_id: 'pi_test_003',
    processed_at: now(),
  });

  return { tenant, owner, experiences: [exp1, exp2, exp3], customers: [c1, c2, c3], bookings: [bk1, bk2, bk3] };
}
