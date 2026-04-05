#!/usr/bin/env node
// ============================================================
// GOBOKI — Full Integration Test Suite
// Spins up real HTTP server, runs 60+ endpoint tests
// ============================================================
import { seedDatabase } from './src/database.mjs';
import { createGobokiServer } from './src/router.mjs';

const PORT = 4242;
const BASE = `http://localhost:${PORT}/api/v1`;

// ── Test framework ────────────────────────────────────────────
const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const DIM  = s => `\x1b[2m${s}\x1b[0m`;
const BOLD = s => `\x1b[1m${s}\x1b[0m`;
const CYAN = s => `\x1b[36m${s}\x1b[0m`;
const RED  = s => `\x1b[31m${s}\x1b[0m`;
const GRN  = s => `\x1b[32m${s}\x1b[0m`;
const YLW  = s => `\x1b[33m${s}\x1b[0m`;

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write(`  ${PASS} ${DIM(name)}\n`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    process.stdout.write(`  ${FAIL} ${name}\n`);
    process.stdout.write(`      ${RED('→ ' + err.message)}\n`);
  }
}

function section(label) {
  console.log('\n' + CYAN('  ' + label));
}

// ── HTTP client ───────────────────────────────────────────────
async function req(method, path, { body, token, expectStatus } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (expectStatus && res.status !== expectStatus) {
    throw new Error(`Expected HTTP ${expectStatus}, got ${res.status}: ${JSON.stringify(data)}`);
  }
  return { status: res.status, data, headers: res.headers };
}

const GET    = (path, opts) => req('GET',    path, opts);
const POST   = (path, opts) => req('POST',   path, opts);
const PATCH  = (path, opts) => req('PATCH',  path, opts);
const DELETE = (path, opts) => req('DELETE', path, opts);

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assertMatch(str, re, msg) { if (!re.test(String(str))) throw new Error(msg || `"${str}" did not match ${re}`); }

// ── Shared state across tests ─────────────────────────────────
let TOKEN, REFRESH_TOKEN;
let BOOKING_ID, PAYMENT_ID, NEW_CUSTOMER_ID, NEW_BOOKING_ID;

// ════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════
async function runAll() {
  // Boot
  console.log('\n' + BOLD('═'.repeat(64)));
  console.log(BOLD('  GOBOKI — Full Integration Test Suite'));
  console.log(BOLD('  Real HTTP server · In-memory DB · 60+ endpoint tests'));
  console.log(BOLD('═'.repeat(64)));

  const seed = seedDatabase();
  const server = createGobokiServer();

  await new Promise(resolve => server.listen(PORT, resolve));
  console.log(DIM(`\n  Server started on port ${PORT}`));
  console.log(DIM(`  Seeded: ${seed.experiences.length} experiences, ${seed.customers.length} customers, ${seed.bookings.length} bookings\n`));

  const t0 = Date.now();

  // ── 1. HEALTH ───────────────────────────────────────────────
  section('🏥  HEALTH CHECK');

  await test('GET /health returns 200', async () => {
    const r = await GET('/health', { expectStatus: 200 });
    assertEq(r.data.status, 'ok');
    assertEq(r.data.service, 'GOBOKI API');
    assert(r.data.db.tenants >= 1, 'Should have seeded tenants');
    assert(r.data.db.experiences >= 3, 'Should have seeded experiences');
  });

  await test('Health reports correct DB counts', async () => {
    const r = await GET('/health');
    assert(r.data.db.customers >= 3, `Expected >=3 customers, got ${r.data.db.customers}`);
    assert(r.data.db.bookings >= 3, `Expected >=3 bookings, got ${r.data.db.bookings}`);
    assert(r.data.db.payments >= 2, `Expected >=2 payments, got ${r.data.db.payments}`);
  });

  // ── 2. AUTH ─────────────────────────────────────────────────
  section('🔐  AUTH');

  await test('POST /auth/login with valid credentials', async () => {
    const r = await POST('/auth/login', {
      body: { email: 'jordan@bluehorizon.com', password: 'Demo1234!' },
      expectStatus: 200,
    });
    assert(r.data.accessToken, 'Should return accessToken');
    assert(r.data.refreshToken, 'Should return refreshToken');
    assertEq(r.data.expiresIn, 900);
    TOKEN = r.data.accessToken;
    REFRESH_TOKEN = r.data.refreshToken;
  });

  await test('POST /auth/login with wrong password returns 401', async () => {
    const r = await POST('/auth/login', {
      body: { email: 'jordan@bluehorizon.com', password: 'WrongPass!' },
      expectStatus: 401,
    });
    assert(r.data.error, 'Should return error message');
  });

  await test('POST /auth/login with unknown email returns 401', async () => {
    const r = await POST('/auth/login', {
      body: { email: 'nobody@nowhere.com', password: 'Demo1234!' },
      expectStatus: 401,
    });
    assertEq(r.status, 401);
  });

  await test('POST /auth/login with missing fields returns 400', async () => {
    const r = await POST('/auth/login', { body: { email: 'test@test.com' } });
    assertEq(r.status, 400);
  });

  await test('GET /auth/me with valid token', async () => {
    const r = await GET('/auth/me', { token: TOKEN, expectStatus: 200 });
    assertEq(r.data.email, 'jordan@bluehorizon.com');
    assertEq(r.data.role, 'owner');
    assert(r.data.tenant, 'Should include tenant info');
    assertEq(r.data.tenant.slug, 'blue-horizon');
  });

  await test('GET /auth/me without token returns 401', async () => {
    const r = await GET('/auth/me');
    assertEq(r.status, 401);
  });

  await test('POST /auth/refresh returns new token pair', async () => {
    const r = await POST('/auth/refresh', {
      body: { refreshToken: REFRESH_TOKEN },
      expectStatus: 200,
    });
    assert(r.data.accessToken, 'Should return new accessToken');
    assert(r.data.accessToken !== TOKEN, 'New token should differ from old (iat differs)');
  });

  await test('POST /auth/refresh with invalid token returns 401', async () => {
    const r = await POST('/auth/refresh', {
      body: { refreshToken: 'totally.invalid.token' },
    });
    assertEq(r.status, 401);
  });

  // ── 3. EXPERIENCES ──────────────────────────────────────────
  section('🏄  EXPERIENCES');

  await test('GET /experiences returns seeded list', async () => {
    const r = await GET('/experiences', { token: TOKEN, expectStatus: 200 });
    assert(Array.isArray(r.data), 'Should be array');
    assert(r.data.length >= 3, `Expected >=3 experiences, got ${r.data.length}`);
    assert(r.data.every(e => e.tenant_id), 'All should have tenant_id');
  });

  await test('GET /experiences returns correct fields', async () => {
    const r = await GET('/experiences', { token: TOKEN });
    const surf = r.data.find(e => e.slug === '7-day-surf-retreat');
    assert(surf, 'Should find surf retreat');
    assertEq(surf.base_price, 1420);
    assertEq(surf.duration_days, 7);
    assertEq(surf.location.city, 'Taghazout');
    assert(Array.isArray(surf.inclusions), 'Should have inclusions array');
  });

  await test('GET /experiences/:id returns single experience with pricing rules', async () => {
    const r = await GET('/experiences/exp-001', { token: TOKEN, expectStatus: 200 });
    assertEq(r.data.id, 'exp-001');
    assertEq(r.data.name, '7-Day Surf Retreat');
    assert(Array.isArray(r.data.pricingRules), 'Should include pricing rules');
    assert(r.data.pricingRules.length >= 1, 'Should have at least one pricing rule');
  });

  await test('GET /experiences/:id for unknown ID returns 404', async () => {
    const r = await GET('/experiences/nonexistent', { token: TOKEN, expectStatus: 404 });
    assertEq(r.status, 404);
  });

  await test('POST /experiences creates new experience', async () => {
    const r = await POST('/experiences', {
      token: TOKEN,
      body: {
        name: 'Island Hopping 5D',
        slug: 'island-hopping-5d',
        type: 'tour',
        description: 'Explore 5 islands in 5 days.',
        base_price: 980,
        currency: 'USD',
        duration_days: 5,
        max_capacity: 10,
        min_guests: 2,
        max_guests: 10,
        location: { country: 'PH', city: 'El Nido', coordinates: { lat: 11.17, lng: 119.39 } },
        inclusions: ['Boat transport', 'Snorkel gear', 'Lunch'],
        exclusions: ['Flights'],
      },
      expectStatus: 201,
    });
    assertEq(r.data.slug, 'island-hopping-5d');
    assertEq(r.data.base_price, 980);
    assert(r.data.id, 'Should have generated ID');
  });

  await test('POST /experiences with duplicate slug returns 409', async () => {
    const r = await POST('/experiences', {
      token: TOKEN,
      body: { name: 'Dup', slug: '7-day-surf-retreat', type: 'retreat', base_price: 100 },
      expectStatus: 409,
    });
    assertEq(r.status, 409);
  });

  await test('PATCH /experiences/:id updates fields', async () => {
    const r = await PATCH('/experiences/exp-001', {
      token: TOKEN,
      body: { base_price: 1480, is_active: true },
      expectStatus: 200,
    });
    assertEq(r.data.base_price, 1480);
  });

  await test('GET /experiences/:id/calendar returns month grid', async () => {
    const r = await GET('/experiences/exp-001?year=2025&month=8', {
      token: TOKEN,
      expectStatus: 200,
    });
    assert(Array.isArray(r.data), 'Should be array');
    assertEq(r.data.length, 31, 'August has 31 days');
    const day = r.data[0];
    assert('date' in day, 'Should have date');
    assert('available' in day, 'Should have available');
    assert('remaining' in day, 'Should have remaining');
    assert('pctFull' in day, 'Should have pctFull');
  });

  // ── 4. AVAILABILITY ─────────────────────────────────────────
  section('🗓  AVAILABILITY');

  await test('GET /availability/check for open dates', async () => {
    const r = await GET('/availability/check?experienceId=exp-002&startDate=2025-10-01&endDate=2025-10-09&guests=2', {
      token: TOKEN, expectStatus: 200,
    });
    assertEq(r.data.available, true);
    assert(r.data.subtotal > 0, 'Should have calculated price');
    assert(r.data.depositAmount > 0, 'Should have deposit amount');
    assertEq(r.data.currency, 'USD');
  });

  await test('GET /availability/check applies seasonal pricing rule', async () => {
    // Summer peak rule: replace price with $1650 for exp-001 Jul-Aug
    const r = await GET('/availability/check?experienceId=exp-001&startDate=2025-08-01&endDate=2025-08-08&guests=2', {
      token: TOKEN, expectStatus: 200,
    });
    assert(r.data.appliedRules?.length > 0, 'Should have applied at least one rule');
    // Summer peak = 1650, base was 1480 (after our PATCH above)
    assert(r.data.pricePerPerson === 1650, `Expected 1650 from Summer Peak rule, got ${r.data.pricePerPerson}`);
  });

  await test('GET /availability/check too many guests returns unavailable', async () => {
    const r = await GET('/availability/check?experienceId=exp-002&startDate=2025-10-01&endDate=2025-10-09&guests=50', {
      token: TOKEN, expectStatus: 200,
    });
    assertEq(r.data.available, false);
    assert(r.data.reason, 'Should include reason');
  });

  await test('GET /availability/check missing params returns 400', async () => {
    const r = await GET('/availability/check?experienceId=exp-001', { token: TOKEN });
    assertEq(r.status, 400);
  });

  // ── 5. CUSTOMERS ────────────────────────────────────────────
  section('👥  CUSTOMERS (CRM)');

  await test('GET /customers returns seeded list', async () => {
    const r = await GET('/customers', { token: TOKEN, expectStatus: 200 });
    assert(r.data.data.length >= 3, `Expected >=3 customers`);
    assert(r.data.meta.total >= 3, 'Meta total should be correct');
  });

  await test('GET /customers with search filter', async () => {
    const r = await GET('/customers?search=amira', { token: TOKEN, expectStatus: 200 });
    assertEq(r.data.data.length, 1);
    assertEq(r.data.data[0].first_name, 'Amira');
  });

  await test('GET /customers with tag filter', async () => {
    const r = await GET('/customers?tags=vip', { token: TOKEN, expectStatus: 200 });
    assert(r.data.data.every(c => c.tags.includes('vip')), 'All results should have vip tag');
  });

  await test('GET /customers/stats returns aggregate stats', async () => {
    const r = await GET('/customers/stats', { token: TOKEN, expectStatus: 200 });
    assert(r.data.total >= 3, 'Should count all customers');
    assert('retentionRate' in r.data, 'Should have retention rate');
    assert('avgLifetimeValue' in r.data, 'Should have avg LTV');
  });

  await test('POST /customers creates new customer', async () => {
    const r = await POST('/customers', {
      token: TOKEN,
      body: {
        email: 'new.guest@travel.com',
        firstName: 'Rafael',
        lastName: 'Herrera',
        phone: '+52 55 1234 5678',
        nationality: 'MX',
        tags: ['group', 'safari'],
        source: 'referral',
      },
      expectStatus: 201,
    });
    assertEq(r.data.first_name, 'Rafael');
    assertEq(r.data.email, 'new.guest@travel.com');
    assert(r.data.id, 'Should have ID');
    NEW_CUSTOMER_ID = r.data.id;
  });

  await test('POST /customers with duplicate email returns 409', async () => {
    const r = await POST('/customers', {
      token: TOKEN,
      body: { email: 'amira@surf-life.com', firstName: 'X', lastName: 'Y' },
    });
    assertEq(r.status, 409);
  });

  await test('POST /customers with invalid email returns 400', async () => {
    const r = await POST('/customers', {
      token: TOKEN,
      body: { email: 'not-an-email', firstName: 'X', lastName: 'Y' },
    });
    assertEq(r.status, 400);
  });

  await test('GET /customers/:id returns full profile with bookings', async () => {
    const r = await GET('/customers/cust-001', { token: TOKEN, expectStatus: 200 });
    assertEq(r.data.email, 'amira@surf-life.com');
    assert(Array.isArray(r.data.bookings), 'Should include bookings array');
    assert(r.data.bookings.length >= 1, 'Amira should have at least 1 booking');
  });

  await test('PATCH /customers/:id updates fields', async () => {
    const r = await PATCH(`/customers/${NEW_CUSTOMER_ID}`, {
      token: TOKEN,
      body: { notes: 'Prefers vegetarian meals', tags: ['group', 'safari', 'vip'] },
      expectStatus: 200,
    });
    assertEq(r.data.notes, 'Prefers vegetarian meals');
    assert(r.data.tags.includes('vip'), 'Should have vip tag');
  });

  await test('POST /customers/:id/tags adds a tag', async () => {
    const r = await POST('/customers/cust-002/tags', {
      token: TOKEN,
      body: { tag: 'premium' },
      expectStatus: 200,
    });
    assert(r.data.tags.includes('premium'), 'Should have premium tag');
  });

  await test('POST /customers/:id/tags is idempotent (no duplicate tags)', async () => {
    await POST('/customers/cust-002/tags', { token: TOKEN, body: { tag: 'premium' } });
    const r = await GET('/customers/cust-002', { token: TOKEN });
    const premiumCount = r.data.tags.filter(t => t === 'premium').length;
    assertEq(premiumCount, 1, 'Should not duplicate tags');
  });

  await test('DELETE /customers/:id/tags/:tag removes a tag', async () => {
    const r = await DELETE('/customers/cust-002/tags/premium', { token: TOKEN, expectStatus: 200 });
    assert(!r.data.tags.includes('premium'), 'Tag should be removed');
  });

  await test('GET /customers/export returns CSV', async () => {
    const res = await fetch(`${BASE}/customers/export`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const text = await res.text();
    assert(text.startsWith('id,email'), 'CSV should start with header row');
    assert(text.includes('amira@surf-life.com'), 'CSV should include seeded customer');
  });

  // ── 6. BOOKINGS ─────────────────────────────────────────────
  section('📅  BOOKINGS');

  await test('GET /bookings returns all bookings with pagination', async () => {
    const r = await GET('/bookings', { token: TOKEN, expectStatus: 200 });
    assert(r.data.data.length >= 3, `Expected >=3 bookings, got ${r.data.data.length}`);
    assert(r.data.meta.total >= 3, 'Meta total should match');
    assert(r.data.meta.page === 1, 'Default page should be 1');
    const b = r.data.data[0];
    assert(b.customer, 'Should include customer info');
    assert(b.experience, 'Should include experience info');
    assert('balanceDue' in b, 'Should have balanceDue');
  });

  await test('GET /bookings?status=confirmed filters by status', async () => {
    const r = await GET('/bookings?status=confirmed', { token: TOKEN, expectStatus: 200 });
    assert(r.data.data.every(b => b.status === 'confirmed'), 'All should be confirmed');
  });

  await test('GET /bookings?status=pending filters correctly', async () => {
    const r = await GET('/bookings?status=pending', { token: TOKEN, expectStatus: 200 });
    assertEq(r.data.data.length, 1);
    assertEq(r.data.data[0].reference, 'BK-2025-0002');
  });

  await test('GET /bookings?search= filters by customer name', async () => {
    const r = await GET('/bookings?search=Amira', { token: TOKEN, expectStatus: 200 });
    assert(r.data.data.length >= 1, 'Should find Amira\'s booking');
    assert(r.data.data.every(b => b.customer?.firstName === 'Amira' || b.customer?.email?.includes('amira')));
  });

  await test('GET /bookings?page=1&limit=2 respects pagination', async () => {
    const r = await GET('/bookings?page=1&limit=2', { token: TOKEN, expectStatus: 200 });
    assert(r.data.data.length <= 2, 'Should return at most 2 items');
    assertEq(r.data.meta.limit, 2);
  });

  await test('GET /bookings/calendar returns month data', async () => {
    const r = await GET('/bookings/calendar?year=2025&month=8', { token: TOKEN, expectStatus: 200 });
    assert(Array.isArray(r.data), 'Should return array');
    assert(r.data.every(b => b.start_date >= '2025-08-01'), 'All should be in August range');
  });

  await test('GET /bookings/:id returns full booking detail', async () => {
    const r = await GET('/bookings/bk-001', { token: TOKEN, expectStatus: 200 });
    assertEq(r.data.reference, 'BK-2025-0001');
    assertEq(r.data.status, 'confirmed');
    assertEq(r.data.total_amount, 2840);
    assertEq(r.data.paid_amount, 852);
    assertEq(r.data.balanceDue, 1988);
    assert(Array.isArray(r.data.payments), 'Should include payments');
    assert(r.data.payments.length >= 1, 'Should have at least 1 payment');
  });

  await test('GET /bookings/:id for unknown ID returns 404', async () => {
    const r = await GET('/bookings/nonexistent', { token: TOKEN, expectStatus: 404 });
    assertEq(r.status, 404);
  });

  await test('POST /bookings creates new booking with pricing', async () => {
    // Use future date
    const startDate = new Date(); startDate.setDate(startDate.getDate() + 60);
    const endDate   = new Date(startDate); endDate.setDate(endDate.getDate() + 7);
    const r = await POST('/bookings', {
      token: TOKEN,
      body: {
        customerId:   NEW_CUSTOMER_ID,
        experienceId: 'exp-003',
        startDate:    startDate.toISOString().split('T')[0],
        endDate:      endDate.toISOString().split('T')[0],
        adults: 2,
        children: 0,
        depositPercent: 30,
        specialRequests: 'Ground floor room please',
        source: 'api',
      },
      expectStatus: 201,
    });
    assertEq(r.data.status, 'pending');
    assertEq(r.data.guests, 2);
    assert(r.data.reference.startsWith('BK-'), 'Should have reference');
    assert(r.data.total_amount > 0, 'Should have calculated total');
    assert(r.data.deposit_amount > 0, 'Should have deposit amount');
    assert(r.data.pricing, 'Should include pricing breakdown');
    assertEq(r.data.specialRequests ?? r.data.special_requests, 'Ground floor room please');
    NEW_BOOKING_ID = r.data.id;
    BOOKING_ID     = 'bk-002'; // use seeded pending booking for status tests
  });

  await test('POST /bookings with past date returns 400', async () => {
    const r = await POST('/bookings', {
      token: TOKEN,
      body: {
        customerId: NEW_CUSTOMER_ID, experienceId: 'exp-003',
        startDate: '2020-01-01', endDate: '2020-01-08', adults: 1,
      },
    });
    assertEq(r.status, 400);
  });

  await test('POST /bookings with unknown customer returns 404', async () => {
    const future = new Date(); future.setDate(future.getDate() + 90);
    const r = await POST('/bookings', {
      token: TOKEN,
      body: {
        customerId: 'no-such-customer', experienceId: 'exp-001',
        startDate: future.toISOString().split('T')[0],
        endDate: new Date(future.getTime() + 7*86400000).toISOString().split('T')[0],
        adults: 1,
      },
    });
    assertEq(r.status, 404);
  });

  await test('PATCH /bookings/:id confirm pending booking', async () => {
    const r = await PATCH(`/bookings/${BOOKING_ID}`, {
      token: TOKEN,
      body: { status: 'confirmed' },
      expectStatus: 200,
    });
    assertEq(r.data.status, 'confirmed');
  });

  await test('PATCH /bookings/:id invalid state transition returns 422', async () => {
    // confirmed → completed is not a valid transition
    const r = await PATCH(`/bookings/${BOOKING_ID}`, {
      token: TOKEN,
      body: { status: 'completed' },
    });
    assertEq(r.status, 422);
  });

  await test('DELETE /bookings/:id cancels booking', async () => {
    const r = await DELETE(`/bookings/${NEW_BOOKING_ID}`, {
      token: TOKEN,
      body: { reason: 'Customer changed plans' },
      expectStatus: 200,
    });
    assertEq(r.data.status, 'cancelled');
    assert(r.data.cancelled_at, 'Should have cancellation timestamp');
    assert(r.data.cancel_reason, 'Should have cancellation reason');
  });

  // ── 7. PAYMENTS ─────────────────────────────────────────────
  section('💳  PAYMENTS');

  await test('POST /payments/stripe/intent creates intent details', async () => {
    const r = await POST('/payments/stripe/intent', {
      token: TOKEN,
      body: { bookingId: BOOKING_ID, amount: 1560, currency: 'USD', isDeposit: true },
      expectStatus: 200,
    });
    assert(r.data.clientSecret?.includes('pi_mock'), 'Should have mock client secret');
    assert(r.data.paymentIntentId?.startsWith('pi_mock'), 'Should have intent ID');
    assertEq(r.data.amount, 156000, 'Amount should be in cents (× 100)');
    assertEq(r.data.currency, 'usd');
    assertEq(r.data.metadata.type, 'deposit');
  });

  await test('POST /payments/charge records a real payment', async () => {
    const r = await POST('/payments/charge', {
      token: TOKEN,
      body: { bookingId: BOOKING_ID, amount: 1560, currency: 'USD', provider: 'stripe', isDeposit: true },
      expectStatus: 201,
    });
    assert(r.data.payment.id, 'Should create payment record');
    assertEq(r.data.payment.amount, 1560);
    assertEq(r.data.payment.status, 'succeeded');
    assertEq(r.data.booking.status, 'deposit_paid', `Expected deposit_paid, got ${r.data.booking.status}`);
    PAYMENT_ID = r.data.payment.id;
  });

  await test('Booking paid_amount updated after charge', async () => {
    const r = await GET(`/bookings/${BOOKING_ID}`, { token: TOKEN });
    assert(r.data.paid_amount >= 1560, `paid_amount should be >= 1560, got ${r.data.paid_amount}`);
  });

  await test('POST /payments/charge that exceeds balance due returns 422', async () => {
    const booking = await GET(`/bookings/${BOOKING_ID}`, { token: TOKEN });
    const balanceDue = booking.data.balanceDue;
    const r = await POST('/payments/charge', {
      token: TOKEN,
      body: { bookingId: BOOKING_ID, amount: balanceDue + 9999, currency: 'USD' },
    });
    assertEq(r.status, 422);
  });

  await test('GET /payments lists all payments for tenant', async () => {
    const r = await GET('/payments', { token: TOKEN, expectStatus: 200 });
    assert(r.data.data.length >= 2, 'Should have at least 2 seeded payments');
  });

  await test('GET /payments?bookingId= filters by booking', async () => {
    const r = await GET(`/payments?bookingId=${BOOKING_ID}`, { token: TOKEN, expectStatus: 200 });
    assert(r.data.data.every(p => p.booking_id === BOOKING_ID), 'All should match booking');
  });

  await test('POST /payments/refund issues partial refund', async () => {
    const r = await POST('/payments/refund', {
      token: TOKEN,
      body: { paymentId: PAYMENT_ID, amount: 200, reason: 'Partial cancellation' },
      expectStatus: 200,
    });
    assertEq(r.data.amount, -200, 'Refund should be negative amount');
    assertEq(r.data.type, 'partial_refund');
    assertEq(r.data.status, 'succeeded');
  });

  await test('POST /payments/refund exceeding original amount returns 422', async () => {
    const r = await POST('/payments/refund', {
      token: TOKEN,
      body: { paymentId: PAYMENT_ID, amount: 999999 },
    });
    assertEq(r.status, 422);
  });

  // ── 8. ANALYTICS ────────────────────────────────────────────
  section('📊  ANALYTICS');

  await test('GET /analytics/overview returns dashboard stats', async () => {
    const r = await GET('/analytics/overview', { token: TOKEN, expectStatus: 200 });
    assert('revenue' in r.data, 'Should have revenue');
    assert('bookings' in r.data, 'Should have bookings');
    assert('occupancy' in r.data, 'Should have occupancy');
    assert('customers' in r.data, 'Should have customers');
    assert(r.data.bookings.total >= 3, `Expected >=3 total bookings, got ${r.data.bookings.total}`);
    assert(r.data.customers.total >= 3, 'Should count seeded customers');
    assert(Array.isArray(r.data.occupancy.byExperience), 'Should have per-experience occupancy');
  });

  await test('GET /analytics/overview revenue is correct', async () => {
    const r = await GET('/analytics/overview', { token: TOKEN });
    assert(r.data.revenue.total >= 0, 'Revenue total should be non-negative');
    assertEq(r.data.revenue.currency, 'USD');
  });

  await test('GET /analytics/top-experiences returns ranked list', async () => {
    const r = await GET('/analytics/top-experiences?limit=3', { token: TOKEN, expectStatus: 200 });
    assert(Array.isArray(r.data), 'Should be array');
    assert(r.data.length <= 3, 'Should respect limit');
    assert(r.data.every(e => e.name && e.bookingCount >= 0), 'Each should have name and count');
    // Sorted by revenue descending
    for (let i = 0; i < r.data.length - 1; i++) {
      assert(r.data[i].totalRevenue >= r.data[i+1].totalRevenue, 'Should be sorted by revenue');
    }
  });

  // ── 9. WEBHOOKS ─────────────────────────────────────────────
  section('🔗  WEBHOOKS');

  await test('POST /webhooks/sign creates HMAC signature', async () => {
    const r = await POST('/webhooks/sign', {
      body: { payload: JSON.stringify({ event: 'booking.confirmed', bookingId: 'bk-001' }), secret: 'my-secret-key' },
      expectStatus: 200,
    });
    assert(r.data.signature.startsWith('sha256='), 'Signature should be sha256=...');
    assert(r.data.body, 'Should return body');
  });

  await test('POST /webhooks/sign produces verifiable signatures', async () => {
    const payload = JSON.stringify({ event: 'test', data: { id: 'abc' } });
    const sign = await POST('/webhooks/sign', {
      body: { payload, secret: 'verify-test-secret' },
    });
    assert(sign.data.signature, 'Should have signature');
    // Re-sign same payload, should get same signature
    const sign2 = await POST('/webhooks/sign', {
      body: { payload, secret: 'verify-test-secret' },
    });
    assertEq(sign.data.signature, sign2.data.signature, 'Same payload+secret → same signature');
  });

  await test('POST /webhooks/test fires webhook event', async () => {
    const r = await POST('/webhooks/test', {
      token: TOKEN,
      body: { event: 'booking.confirmed', data: { bookingId: 'bk-001', amount: 2840 } },
      expectStatus: 200,
    });
    assertEq(r.data.event, 'booking.confirmed');
    assertEq(r.data.fired, 0, 'No webhooks configured in demo, so 0 fired');
    assert(r.data.payload.id, 'Payload should have unique ID');
    assert(r.data.payload.timestamp, 'Payload should have timestamp');
  });

  // ── 10. PUBLIC BOOKING WIDGET API ────────────────────────────
  section('🌐  PUBLIC BOOKING WIDGET');

  await test('GET /public/:slug/experiences returns public experience list', async () => {
    const r = await GET('/public/blue-horizon/experiences', { expectStatus: 200 });
    assert(Array.isArray(r.data), 'Should return array');
    assert(r.data.length >= 3, 'Should list all active experiences');
    // No auth required
  });

  await test('GET /public/invalid-slug/experiences returns 404', async () => {
    const r = await GET('/public/no-such-tenant/experiences', { expectStatus: 404 });
    assertEq(r.status, 404);
  });

  await test('GET /public/:slug/availability checks dates without auth', async () => {
    const r = await GET('/public/blue-horizon/availability?experienceId=exp-003&startDate=2025-11-01&endDate=2025-11-08&guests=1', {
      expectStatus: 200,
    });
    assert('available' in r.data, 'Should return availability');
    assert(r.data.subtotal > 0, 'Should return pricing');
  });

  await test('POST /public/:slug/bookings creates booking end-to-end', async () => {
    const startDate = new Date(); startDate.setDate(startDate.getDate() + 90);
    const endDate   = new Date(startDate); endDate.setDate(endDate.getDate() + 7);
    const r = await POST('/public/blue-horizon/bookings', {
      body: {
        experienceId: 'exp-002',
        email:        'widget.guest@test.com',
        firstName:    'Widget',
        lastName:     'Guest',
        phone:        '+1 555 000 1234',
        adults: 2,
        startDate:    startDate.toISOString().split('T')[0],
        endDate:      endDate.toISOString().split('T')[0],
        depositPercent: 30,
      },
      expectStatus: 201,
    });
    assert(r.data.booking, 'Should return booking');
    assert(r.data.clientSecret, 'Should return Stripe client secret for payment');
    assertEq(r.data.booking.status, 'pending');
    assertEq(r.data.booking.guests, 2);
    assertEq(r.data.booking.source, 'widget');
    assert(r.data.booking.reference.startsWith('BK-'), 'Should have reference');
  });

  await test('POST /public/:slug/bookings creates customer if not exists', async () => {
    // Check the new customer was created in the widget flow
    const r = await GET('/customers?search=widget.guest', { token: TOKEN });
    assert(r.data.data.length >= 1, 'Widget guest should be in CRM');
    assertEq(r.data.data[0].source, 'widget', 'Source should be widget');
  });

  // ── 11. SECURITY ─────────────────────────────────────────────
  section('🔒  SECURITY');

  await test('Protected endpoints reject missing token', async () => {
    const endpoints = ['/experiences', '/bookings', '/customers', '/analytics/overview', '/payments'];
    for (const ep of endpoints) {
      const r = await GET(ep);
      assert(r.status === 401, `${ep} should require auth, got ${r.status}`);
    }
  });

  await test('Protected endpoints reject invalid token', async () => {
    const r = await GET('/bookings', { token: 'fake.jwt.token', expectStatus: 401 });
    assertEq(r.status, 401);
  });

  await test('404 for completely unknown routes', async () => {
    const r = await GET('/gobbledygook/does/not/exist', { token: TOKEN });
    assertEq(r.status, 404);
  });

  await test('Tenant isolation: data scoped to token tenant', async () => {
    // Our token is for tenant-001. All returned data should be for that tenant.
    const bookings = await GET('/bookings', { token: TOKEN });
    assert(bookings.data.data.every(b => b.tenant_id === 'tenant-001'), 'All bookings should belong to token tenant');
    const customers = await GET('/customers', { token: TOKEN });
    assert(customers.data.data.every(c => c.tenant_id === 'tenant-001'), 'All customers should belong to token tenant');
  });

  // ── SUMMARY ──────────────────────────────────────────────────
  const elapsed = Date.now() - t0;
  const total   = passed + failed;

  console.log('\n' + BOLD('═'.repeat(64)));
  console.log(`  ${GRN(passed + ' passed')}  ${failed > 0 ? RED(failed + ' failed') : DIM('0 failed')}  ${DIM(total + ' total')}  ${DIM(elapsed + 'ms')}`);
  console.log(BOLD('═'.repeat(64)));

  if (failures.length > 0) {
    console.log(RED('\n  Failed tests:'));
    failures.forEach(f => {
      console.log(`  ${FAIL} ${f.name}`);
      console.log(`      ${RED('→ ' + f.error)}`);
    });
  } else {
    console.log(GRN('\n  ✅ All tests passed — GOBOKI is fully operational!\n'));
  }

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
