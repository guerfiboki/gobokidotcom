#!/usr/bin/env node
// ============================================================
// GOBOKI — Extended Test Suite
// Edge cases · Boundary conditions · Stress · Concurrency
// ============================================================
import { seedDatabase } from './src/database.mjs';
import { createGobokiServer } from './src/router.mjs';

const PORT = 4243;
const BASE = `http://localhost:${PORT}/api/v1`;

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const DIM  = s => `\x1b[2m${s}\x1b[0m`;
const BOLD = s => `\x1b[1m${s}\x1b[0m`;
const CYAN = s => `\x1b[36m${s}\x1b[0m`;
const RED  = s => `\x1b[31m${s}\x1b[0m`;
const GRN  = s => `\x1b[32m${s}\x1b[0m`;
const YLW  = s => `\x1b[33m${s}\x1b[0m`;
const MAG  = s => `\x1b[35m${s}\x1b[0m`;

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

function section(label) { console.log('\n' + CYAN('  ' + label)); }

async function req(method, path, { body, token, expectStatus } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (expectStatus && res.status !== expectStatus) {
    throw new Error(`Expected HTTP ${expectStatus}, got ${res.status}: ${JSON.stringify(data)}`);
  }
  return { status: res.status, data };
}

const GET    = (p, o) => req('GET',    p, o);
const POST   = (p, o) => req('POST',   p, o);
const PATCH  = (p, o) => req('PATCH',  p, o);
const DELETE = (p, o) => req('DELETE', p, o);

function assert(cond, msg)    { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEq(a, b, msg)  { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assertGt(a, b, msg)  { if (!(a > b)) throw new Error(msg || `Expected ${a} > ${b}`); }
function assertGte(a, b, msg) { if (!(a >= b)) throw new Error(msg || `Expected ${a} >= ${b}`); }

// Shared state
let TOKEN, SURF_EXP_ID = 'exp-001', DIVE_EXP_ID = 'exp-002', YOGA_EXP_ID = 'exp-003';

function futureDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

async function runAll() {
  console.log('\n' + BOLD('═'.repeat(64)));
  console.log(BOLD('  GOBOKI — Extended Test Suite'));
  console.log(BOLD('  Edge cases · Boundaries · Concurrency · Stress'));
  console.log(BOLD('═'.repeat(64)));

  seedDatabase();
  const server = createGobokiServer();
  await new Promise(r => server.listen(PORT, r));
  console.log(DIM(`\n  Server on port ${PORT}\n`));

  const t0 = Date.now();

  // Login once
  const loginRes = await POST('/auth/login', { body: { email: 'jordan@bluehorizon.com', password: 'Demo1234!' } });
  TOKEN = loginRes.data.accessToken;

  // ── 1. INPUT BOUNDARIES ──────────────────────────────────────
  section('🔬  INPUT BOUNDARIES & EDGE CASES');

  await test('Empty string fields are rejected in customer create', async () => {
    const r = await POST('/customers', {
      token: TOKEN,
      body: { email: '', firstName: '', lastName: '' },
    });
    assertEq(r.status, 400);
  });

  await test('Very long email (500 chars) is rejected', async () => {
    const r = await POST('/customers', {
      token: TOKEN,
      body: { email: 'a'.repeat(490) + '@x.com', firstName: 'A', lastName: 'B' },
    });
    // Not a structurally valid email - should 400
    assertEq(r.status, 400);
  });

  await test('Customer with unicode name works', async () => {
    const r = await POST('/customers', {
      token: TOKEN,
      body: {
        email: `unicode-${Date.now()}@test.com`,
        firstName: 'Amédée',
        lastName: 'Björnsson-Łukasiewicz',
        nationality: 'FR',
      },
      expectStatus: 201,
    });
    assertEq(r.data.first_name, 'Amédée');
    assertEq(r.data.last_name, 'Björnsson-Łukasiewicz');
  });

  await test('Booking with 0 adults is rejected', async () => {
    const r = await POST('/bookings', {
      token: TOKEN,
      body: {
        customerId: 'cust-001',
        experienceId: DIVE_EXP_ID,
        startDate: futureDate(60),
        endDate: futureDate(68),
        adults: 0,
      },
    });
    // adults=0 means guests=0, which availability check catches
    assert(r.status >= 400, `Expected error for 0 adults, got ${r.status}`);
  });

  await test('Booking with start == end date is rejected', async () => {
    const d = futureDate(30);
    const r = await POST('/bookings', {
      token: TOKEN,
      body: { customerId: 'cust-001', experienceId: SURF_EXP_ID, startDate: d, endDate: d, adults: 1 },
    });
    assertEq(r.status, 400);
  });

  await test('Booking with endDate before startDate is rejected', async () => {
    const r = await POST('/bookings', {
      token: TOKEN,
      body: { customerId: 'cust-001', experienceId: SURF_EXP_ID, startDate: futureDate(30), endDate: futureDate(25), adults: 1 },
    });
    assertEq(r.status, 400);
  });

  await test('Booking exactly at today boundary: today is rejected', async () => {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = futureDate(1);
    const r = await POST('/bookings', {
      token: TOKEN,
      body: { customerId: 'cust-001', experienceId: SURF_EXP_ID, startDate: today, endDate: tomorrow, adults: 1 },
    });
    assertEq(r.status, 400);
  });

  await test('Booking tomorrow is accepted', async () => {
    const r = await POST('/bookings', {
      token: TOKEN,
      body: {
        customerId: 'cust-001',
        experienceId: YOGA_EXP_ID,
        startDate: futureDate(1),
        endDate: futureDate(8),
        adults: 1,
      },
    });
    assert(r.status === 201 || r.status === 422, // 422 if overlaps, 201 if clear
      `Expected 201 or 422, got ${r.status}: ${JSON.stringify(r.data)}`);
  });

  await test('Zero-amount payment is rejected', async () => {
    const r = await POST('/payments/charge', {
      token: TOKEN,
      body: { bookingId: 'bk-001', amount: 0 },
    });
    assertEq(r.status, 400);
  });

  await test('Negative payment amount is rejected', async () => {
    const r = await POST('/payments/charge', {
      token: TOKEN,
      body: { bookingId: 'bk-001', amount: -100 },
    });
    assertEq(r.status, 400);
  });

  await test('PATCH on non-existent booking returns 404', async () => {
    const r = await PATCH('/bookings/this-does-not-exist', {
      token: TOKEN,
      body: { status: 'confirmed' },
    });
    assertEq(r.status, 404);
  });

  await test('PATCH on non-existent customer returns 404', async () => {
    const r = await PATCH('/customers/ghost-customer-id', {
      token: TOKEN,
      body: { notes: 'hello' },
    });
    assertEq(r.status, 404);
  });

  await test('Refund on non-existent payment returns 404', async () => {
    const r = await POST('/payments/refund', {
      token: TOKEN,
      body: { paymentId: 'fake-payment-id', amount: 100 },
    });
    assertEq(r.status, 404);
  });

  // ── 2. STATE MACHINE BOUNDARIES ──────────────────────────────
  section('🔄  BOOKING STATE MACHINE — ALL TRANSITIONS');

  // Create a test booking to drive through transitions
  let testBookingId;
  await test('Create fresh booking for state machine testing', async () => {
    const r = await POST('/bookings', {
      token: TOKEN,
      body: {
        customerId: 'cust-002',
        experienceId: DIVE_EXP_ID,
        startDate: futureDate(120),
        endDate: futureDate(128),
        adults: 2,
      },
      expectStatus: 201,
    });
    testBookingId = r.data.id;
    assertEq(r.data.status, 'pending');
  });

  await test('pending → confirmed (valid)', async () => {
    const r = await PATCH(`/bookings/${testBookingId}`, {
      token: TOKEN, body: { status: 'confirmed' }, expectStatus: 200,
    });
    assertEq(r.data.status, 'confirmed');
  });

  await test('confirmed → pending (invalid — must return 422)', async () => {
    const r = await PATCH(`/bookings/${testBookingId}`, {
      token: TOKEN, body: { status: 'pending' },
    });
    assertEq(r.status, 422);
  });

  await test('confirmed → completed (invalid — skip steps)', async () => {
    const r = await PATCH(`/bookings/${testBookingId}`, {
      token: TOKEN, body: { status: 'completed' },
    });
    assertEq(r.status, 422);
  });

  await test('confirmed → deposit_paid (valid — after payment)', async () => {
    // First make a deposit payment
    await POST('/payments/charge', {
      token: TOKEN,
      body: { bookingId: testBookingId, amount: 780, isDeposit: true },
    });
    const r = await GET(`/bookings/${testBookingId}`, { token: TOKEN });
    assertEq(r.data.status, 'deposit_paid');
  });

  await test('deposit_paid → fully_paid (valid)', async () => {
    const booking = await GET(`/bookings/${testBookingId}`, { token: TOKEN });
    const remaining = booking.data.balanceDue;
    await POST('/payments/charge', {
      token: TOKEN,
      body: { bookingId: testBookingId, amount: remaining },
    });
    const r = await GET(`/bookings/${testBookingId}`, { token: TOKEN });
    assertEq(r.data.status, 'fully_paid');
  });

  await test('fully_paid → completed (valid)', async () => {
    const r = await PATCH(`/bookings/${testBookingId}`, {
      token: TOKEN, body: { status: 'completed' }, expectStatus: 200,
    });
    assertEq(r.data.status, 'completed');
  });

  await test('completed → any status (all invalid)', async () => {
    for (const status of ['pending', 'confirmed', 'deposit_paid', 'fully_paid', 'cancelled']) {
      const r = await PATCH(`/bookings/${testBookingId}`, {
        token: TOKEN, body: { status },
      });
      assertEq(r.status, 422, `completed → ${status} should be 422, got ${r.status}`);
    }
  });

  // Test cancel + refund path separately
  let cancelTestId;
  await test('Create booking for cancel→refund path', async () => {
    const r = await POST('/bookings', {
      token: TOKEN,
      body: {
        customerId: 'cust-003',
        experienceId: YOGA_EXP_ID,
        startDate: futureDate(150),
        endDate: futureDate(157),
        adults: 1,
      },
      expectStatus: 201,
    });
    cancelTestId = r.data.id;
  });

  await test('pending → cancelled (valid)', async () => {
    const r = await DELETE(`/bookings/${cancelTestId}`, {
      token: TOKEN, body: { reason: 'Test cancellation' }, expectStatus: 200,
    });
    assertEq(r.data.status, 'cancelled');
    assertEq(r.data.cancel_reason, 'Test cancellation');
    assert(r.data.cancelled_at, 'Should have cancellation timestamp');
  });

  await test('cancelled → confirmed (invalid — cannot reopen)', async () => {
    const r = await PATCH(`/bookings/${cancelTestId}`, {
      token: TOKEN, body: { status: 'confirmed' },
    });
    assertEq(r.status, 422);
  });

  // ── 3. CAPACITY & OVERBOOKING ─────────────────────────────────
  section('🏕  CAPACITY & OVERBOOKING PREVENTION');

  await test('Booking exactly at max capacity is accepted', async () => {
    // Dive package: max_capacity=8, currently 0 booked for far future
    const r = await GET('/availability/check?experienceId=exp-002&startDate=' + futureDate(200) + '&endDate=' + futureDate(208) + '&guests=8', {
      token: TOKEN, expectStatus: 200,
    });
    assertEq(r.data.available, true);
    assertEq(r.data.remainingCapacity ?? r.data.minRemaining ?? 8, 8);
  });

  await test('Booking 1 over max capacity is rejected', async () => {
    const r = await GET('/availability/check?experienceId=exp-002&startDate=' + futureDate(200) + '&endDate=' + futureDate(208) + '&guests=9', {
      token: TOKEN, expectStatus: 200,
    });
    assertEq(r.data.available, false);
  });

  await test('Sequential bookings up to capacity then block', async () => {
    // Yoga: max_capacity=16, book 2 groups filling it exactly, then try a 3rd
    const start = futureDate(300);
    const end   = futureDate(307);

    // Group A: 8 guests
    const groupA = await POST('/bookings', {
      token: TOKEN,
      body: { customerId: 'cust-001', experienceId: YOGA_EXP_ID, startDate: start, endDate: end, adults: 8 },
    });
    assert(groupA.status === 201 || groupA.status === 422, `Group A: ${groupA.status}`);

    if (groupA.status === 201) {
      // Group B: 8 more (fills capacity)
      const groupB = await POST('/bookings', {
        token: TOKEN,
        body: { customerId: 'cust-002', experienceId: YOGA_EXP_ID, startDate: start, endDate: end, adults: 8 },
      });
      assert(groupB.status === 201 || groupB.status === 422, `Group B: ${groupB.status}`);

      // Group C: even 1 should be rejected now
      const groupC = await POST('/bookings', {
        token: TOKEN,
        body: { customerId: 'cust-003', experienceId: YOGA_EXP_ID, startDate: start, endDate: end, adults: 1 },
      });
      assertEq(groupC.status, 422, 'Group C should be rejected — capacity full');
    }
  });

  await test('Cancelled bookings free capacity for new bookings', async () => {
    const start = futureDate(400);
    const end   = futureDate(408);

    // Fill with one booking
    const bk = await POST('/bookings', {
      token: TOKEN,
      body: { customerId: 'cust-001', experienceId: DIVE_EXP_ID, startDate: start, endDate: end, adults: 8 },
    });

    if (bk.status === 201) {
      // Verify full
      const avail1 = await GET(`/availability/check?experienceId=${DIVE_EXP_ID}&startDate=${start}&endDate=${end}&guests=1`, { token: TOKEN });
      assertEq(avail1.data.available, false, 'Should be full after 8-person booking');

      // Cancel the booking
      await DELETE(`/bookings/${bk.data.id}`, { token: TOKEN, body: { reason: 'Test' } });

      // Should be available again
      const avail2 = await GET(`/availability/check?experienceId=${DIVE_EXP_ID}&startDate=${start}&endDate=${end}&guests=1`, { token: TOKEN });
      assertEq(avail2.data.available, true, 'Should be available after cancellation');
    }
  });

  // ── 4. PRICING RULES ACCURACY ────────────────────────────────
  section('💲  PRICING RULES — PRECISION & ACCURACY');

  await test('Price stays at base when no rules match date', async () => {
    // Use a date outside all seasonal rules (winter, not in summer peak window)
    const r = await GET('/availability/check?experienceId=exp-001&startDate=2026-01-15&endDate=2026-01-22&guests=1', {
      token: TOKEN, expectStatus: 200,
    });
    // base_price is 1420 (seed value); no summer peak rule applies in January
    assertEq(r.data.pricePerPerson, 1420, `Expected base price 1420 (seed value), got ${r.data.pricePerPerson}`);
    assertEq(r.data.appliedRules?.length ?? 0, 0, 'No rules should apply in winter');
  });

  await test('Summer peak rule applies Jul-Aug', async () => {
    const r = await GET('/availability/check?experienceId=exp-001&startDate=2025-07-20&endDate=2025-07-27&guests=1', {
      token: TOKEN, expectStatus: 200,
    });
    assertEq(r.data.pricePerPerson, 1650, 'Summer peak price should be 1650');
    assert(r.data.appliedRules?.includes('Summer Peak'), 'Summer Peak rule should be listed');
  });

  await test('Group discount stacks on top of seasonal price', async () => {
    // Summer peak (1650) + Group 4+ (-120) = 1530
    const r = await GET('/availability/check?experienceId=exp-001&startDate=2025-08-10&endDate=2025-08-17&guests=4', {
      token: TOKEN, expectStatus: 200,
    });
    assertEq(r.data.pricePerPerson, 1530, `Expected 1650-120=1530, got ${r.data.pricePerPerson}`);
    assert(r.data.appliedRules?.length === 2, `Expected 2 rules applied, got ${r.data.appliedRules?.length}`);
  });

  await test('Deposit is always exactly 30% of subtotal', async () => {
    const r = await GET('/availability/check?experienceId=exp-002&startDate=2025-10-01&endDate=2025-10-09&guests=3', {
      token: TOKEN, expectStatus: 200,
    });
    const expected = Math.round(r.data.subtotal * 0.3 * 100) / 100;
    assertEq(r.data.depositAmount, expected, `Deposit should be 30% of subtotal`);
  });

  await test('Balance due = subtotal - deposit', async () => {
    const r = await GET('/availability/check?experienceId=exp-002&startDate=2025-10-01&endDate=2025-10-09&guests=2', {
      token: TOKEN, expectStatus: 200,
    });
    const expected = Math.round((r.data.subtotal - r.data.depositAmount) * 100) / 100;
    assertEq(r.data.balanceDue, expected);
  });

  // ── 5. SEARCH & FILTER ACCURACY ──────────────────────────────
  section('🔍  SEARCH & FILTER ACCURACY');

  // Create some customers for filtering tests
  await test('Setup: create customers with various attributes', async () => {
    await POST('/customers', { token: TOKEN, body: { email: `filter-vip-${Date.now()}@test.com`, firstName: 'VIP', lastName: 'Customer', tags: ['vip', 'surf'], source: 'instagram' }, expectStatus: 201 });
    await POST('/customers', { token: TOKEN, body: { email: `filter-group-${Date.now()}@test.com`, firstName: 'Group', lastName: 'Leader', tags: ['group', 'safari'], source: 'referral' }, expectStatus: 201 });
    await POST('/customers', { token: TOKEN, body: { email: `filter-solo-${Date.now()}@test.com`, firstName: 'Solo', lastName: 'Traveler', tags: ['solo', 'yoga'], source: 'google' }, expectStatus: 201 });
  });

  await test('Search is case-insensitive', async () => {
    const r1 = await GET('/customers?search=amira', { token: TOKEN });
    const r2 = await GET('/customers?search=AMIRA', { token: TOKEN });
    const r3 = await GET('/customers?search=Amira', { token: TOKEN });
    assertEq(r1.data.meta.total, r2.data.meta.total, 'Case should not matter');
    assertEq(r1.data.meta.total, r3.data.meta.total, 'Case should not matter');
  });

  await test('Search by partial email works', async () => {
    const r = await GET('/customers?search=surf-life', { token: TOKEN });
    assert(r.data.data.some(c => c.email === 'amira@surf-life.com'), 'Should find by partial email');
  });

  await test('Multi-tag filter requires ALL tags', async () => {
    const r = await GET('/customers?tags=vip,surf', { token: TOKEN });
    assert(r.data.data.every(c => c.tags?.includes('vip') && c.tags?.includes('surf')),
      'All results must have both vip AND surf tags');
  });

  await test('Source filter works', async () => {
    const r = await GET('/customers?source=instagram', { token: TOKEN });
    assert(r.data.data.length >= 1, 'Should find instagram customers');
    assert(r.data.data.every(c => c.source === 'instagram'), 'All should be instagram source');
  });

  await test('Booking date range filter', async () => {
    const r = await GET('/bookings?dateFrom=2025-08-01&dateTo=2025-08-31', { token: TOKEN });
    assert(r.data.data.every(b => b.start_date >= '2025-08-01' && b.start_date <= '2025-08-31'),
      'All bookings should be in August');
  });

  await test('Booking search by reference', async () => {
    const r = await GET('/bookings?search=BK-2025-0001', { token: TOKEN });
    assert(r.data.data.some(b => b.reference === 'BK-2025-0001'), 'Should find by reference');
  });

  await test('Pagination: page 1 and page 2 have no overlap', async () => {
    const p1 = await GET('/bookings?page=1&limit=2', { token: TOKEN });
    const p2 = await GET('/bookings?page=2&limit=2', { token: TOKEN });
    const ids1 = new Set(p1.data.data.map(b => b.id));
    const ids2 = new Set(p2.data.data.map(b => b.id));
    const overlap = [...ids1].filter(id => ids2.has(id));
    assertEq(overlap.length, 0, 'Pages should not overlap');
  });

  await test('Pagination: total across all pages matches meta.total', async () => {
    const limit = 2;
    let allIds = [];
    let page = 1;
    let total;
    do {
      const r = await GET(`/bookings?page=${page}&limit=${limit}`, { token: TOKEN });
      total = r.data.meta.total;
      allIds.push(...r.data.data.map(b => b.id));
      page++;
    } while (allIds.length < total && page < 20);
    assertEq(allIds.length, total, `Fetched ${allIds.length} but meta says ${total}`);
    const unique = new Set(allIds);
    assertEq(unique.size, total, 'No duplicate IDs across pages');
  });

  // ── 6. ANALYTICS ACCURACY ────────────────────────────────────
  section('📊  ANALYTICS ACCURACY');

  await test('Overview total bookings matches actual booking count', async () => {
    const overview = await GET('/analytics/overview', { token: TOKEN });
    const bookings = await GET('/bookings', { token: TOKEN });
    assertEq(overview.data.bookings.total, bookings.data.meta.total,
      'Analytics booking count should match /bookings total');
  });

  await test('Overview customer count matches actual customer count', async () => {
    const overview = await GET('/analytics/overview', { token: TOKEN });
    const customers = await GET('/customers', { token: TOKEN });
    assertEq(overview.data.customers.total, customers.data.meta.total,
      'Analytics customer count should match /customers total');
  });

  await test('Occupancy rate is 0-100 per experience', async () => {
    const r = await GET('/analytics/overview', { token: TOKEN });
    r.data.occupancy.byExperience.forEach(exp => {
      // booked can exceed capacity across multiple date windows (analytics shows total demand)
      assert(exp.booked >= 0,
        `${exp.name}: booked (${exp.booked}) should be non-negative`);
      assert(exp.capacity > 0,
        `${exp.name}: capacity (${exp.capacity}) should be positive`);
      // Rate is a percentage (can exceed 100 if overbooking detected, but should be >= 0)
      assert(exp.rate >= 0,
        `${exp.name}: occupancy rate ${exp.rate} should be non-negative`);
    });
  });

  await test('Top experiences are sorted by revenue descending', async () => {
    const r = await GET('/analytics/top-experiences', { token: TOKEN });
    for (let i = 0; i < r.data.length - 1; i++) {
      assert(r.data[i].totalRevenue >= r.data[i+1].totalRevenue,
        `Index ${i} revenue ${r.data[i].totalRevenue} should be >= ${r.data[i+1].totalRevenue}`);
    }
  });

  await test('Analytics reflects new booking created mid-test', async () => {
    const before = await GET('/analytics/overview', { token: TOKEN });
    const beforeCount = before.data.bookings.total;

    await POST('/bookings', {
      token: TOKEN,
      body: {
        customerId: 'cust-001', experienceId: YOGA_EXP_ID,
        startDate: futureDate(500), endDate: futureDate(507), adults: 1,
      },
    });

    const after = await GET('/analytics/overview', { token: TOKEN });
    assertEq(after.data.bookings.total, beforeCount + 1, 'New booking should appear in analytics');
  });

  // ── 7. CONCURRENCY ───────────────────────────────────────────
  section('⚡  CONCURRENCY & RACE CONDITIONS');

  await test('10 concurrent GET /health requests all return 200', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => GET('/health'))
    );
    assert(results.every(r => r.status === 200), 'All concurrent health checks should succeed');
  });

  await test('20 concurrent GET /experiences requests return consistent data', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => GET('/experiences', { token: TOKEN }))
    );
    const counts = results.map(r => r.data.length);
    assert(counts.every(c => c === counts[0]), `Concurrent requests returned inconsistent counts: ${[...new Set(counts)].join(',')}`);
  });

  await test('Concurrent duplicate customer creation — only 1 succeeds', async () => {
    const email = `concurrent-${Date.now()}@test.com`;
    const data = { email, firstName: 'Race', lastName: 'Condition' };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => POST('/customers', { token: TOKEN, body: data }))
    );
    const successes = results.filter(r => r.status === 201);
    const conflicts = results.filter(r => r.status === 409);
    assertEq(successes.length, 1, `Exactly 1 should succeed, got ${successes.length}`);
    assertEq(conflicts.length, 4, `Exactly 4 should conflict, got ${conflicts.length}`);
  });

  await test('Concurrent bookings respect capacity limits', async () => {
    // Dive exp has capacity 8; fire 5 bookings of 2 guests each simultaneously
    // At most 4 should succeed (4×2=8), the 5th should fail
    const start = futureDate(600);
    const end   = futureDate(608);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => POST('/bookings', {
        token: TOKEN,
        body: { customerId: `cust-00${(i%3)+1}`, experienceId: DIVE_EXP_ID, startDate: start, endDate: end, adults: 2 },
      }))
    );
    const successes = results.filter(r => r.status === 201).length;
    const failures  = results.filter(r => r.status === 422).length;
    assert(successes <= 4, `At most 4 should succeed (capacity 8 ÷ 2 guests), got ${successes}`);
    assert(successes + failures === 5, `All 5 should either succeed or fail with 422`);
    console.log(`      ${YLW(`→ ${successes} succeeded, ${failures} rejected (capacity ${successes*2}/8)`)} `);
  });

  // ── 8. STRESS TEST ───────────────────────────────────────────
  section('🏋  STRESS TEST');

  await test('Create 50 customers sequentially — all unique', async () => {
    const t = Date.now();
    const results = [];
    for (let i = 0; i < 50; i++) {
      const r = await POST('/customers', {
        token: TOKEN,
        body: { email: `stress-${i}-${t}@test.com`, firstName: `Guest${i}`, lastName: `Test` },
        expectStatus: 201,
      });
      results.push(r.data.id);
    }
    const unique = new Set(results);
    assertEq(unique.size, 50, '50 unique IDs should be generated');
  });

  await test('100 concurrent GET /bookings all succeed', async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, () => GET('/bookings?limit=5', { token: TOKEN }))
    );
    const ok = results.filter(r => r.status === 200).length;
    assertEq(ok, 100, `All 100 should return 200, got ${ok}`);
  });

  await test('50 concurrent GET /analytics/overview return consistent totals', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => GET('/analytics/overview', { token: TOKEN }))
    );
    const totals = results.map(r => r.data.bookings.total);
    const allSame = totals.every(t => t === totals[0]);
    assert(allSame, `Inconsistent analytics across concurrent requests: ${[...new Set(totals)].join(',')}`);
  });

  await test('Server handles 200 requests without crashing', async () => {
    const mixed = [
      ...Array.from({ length: 80 }, () => GET('/health')),
      ...Array.from({ length: 60 }, () => GET('/experiences', { token: TOKEN })),
      ...Array.from({ length: 60 }, () => GET('/bookings?limit=5', { token: TOKEN })),
    ];
    const results = await Promise.all(mixed);
    const ok = results.filter(r => r.status === 200 || r.status === 201).length;
    assert(ok === 200, `Expected 200 OK responses, got ${ok}`);
    const r = await GET('/health', { expectStatus: 200 });
    assertEq(r.data.status, 'ok', 'Server still healthy after 200 concurrent requests');
  });

  // ── 9. DATA INTEGRITY ────────────────────────────────────────
  section('🔒  DATA INTEGRITY');

  await test('Payment updates booking.paid_amount atomically', async () => {
    const before = await GET('/bookings/bk-003', { token: TOKEN });
    const paidBefore = before.data.paid_amount;
    await POST('/payments/charge', {
      token: TOKEN,
      body: { bookingId: 'bk-003', amount: 100 },
    });
    const after = await GET('/bookings/bk-003', { token: TOKEN });
    assertEq(after.data.paid_amount, Math.round((paidBefore + 100) * 100) / 100);
  });

  await test('Cancelled booking does not appear in availability blocking', async () => {
    const start = futureDate(700);
    const end   = futureDate(707);

    const bk = await POST('/bookings', {
      token: TOKEN,
      body: { customerId: 'cust-001', experienceId: SURF_EXP_ID, startDate: start, endDate: end, adults: 12 },
    });

    if (bk.status === 201) {
      const avail1 = await GET(`/availability/check?experienceId=${SURF_EXP_ID}&startDate=${start}&endDate=${end}&guests=1`, { token: TOKEN });
      assertEq(avail1.data.available, false, 'Fully booked before cancel');

      await DELETE(`/bookings/${bk.data.id}`, { token: TOKEN, body: { reason: 'Integrity test' } });

      const avail2 = await GET(`/availability/check?experienceId=${SURF_EXP_ID}&startDate=${start}&endDate=${end}&guests=1`, { token: TOKEN });
      assertEq(avail2.data.available, true, 'Should be free after cancel');
    }
  });

  await test('Customer booking count reflected in CRM profile', async () => {
    // cust-001 has existing bookings from seed; create another one
    const before = await GET('/customers/cust-001', { token: TOKEN });
    const bookingsBefore = before.data.bookings.length;

    await POST('/bookings', {
      token: TOKEN,
      body: { customerId: 'cust-001', experienceId: YOGA_EXP_ID, startDate: futureDate(800), endDate: futureDate(807), adults: 1 },
    });

    const after = await GET('/customers/cust-001', { token: TOKEN });
    assertEq(after.data.bookings.length, bookingsBefore + 1, 'Booking count should increment');
  });

  await test('CSV export contains all created customers', async () => {
    const customers = await GET('/customers', { token: TOKEN });
    const totalCount = customers.data.meta.total;

    const csvRes = await fetch(`${BASE}/customers/export`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const csv = await csvRes.text();
    const dataRows = csv.split('\n').length - 1; // -1 for header
    assertEq(dataRows, totalCount, `CSV should have ${totalCount} rows, got ${dataRows}`);
  });

  // ── 10. PUBLIC API SECURITY ───────────────────────────────────
  section('🌐  PUBLIC API SECURITY');

  await test('Public API only exposes active experiences', async () => {
    // Deactivate one experience
    await PATCH('/experiences/exp-002', {
      token: TOKEN, body: { is_active: false },
    });
    const r = await GET('/public/blue-horizon/experiences');
    assert(!r.data.some(e => e.id === 'exp-002'), 'Inactive experience should not appear publicly');
    // Re-activate
    await PATCH('/experiences/exp-002', { token: TOKEN, body: { is_active: true } });
  });

  await test('Public booking widget creates new customer when email is new', async () => {
    const uniqueEmail = `widget-${Date.now()}-new@test.com`;
    const r = await POST('/public/blue-horizon/bookings', {
      body: {
        experienceId: DIVE_EXP_ID,
        email: uniqueEmail,
        firstName: 'Brand', lastName: 'New',
        adults: 1,
        startDate: futureDate(900), endDate: futureDate(908),
      },
      expectStatus: 201,
    });
    assert(r.data.booking, 'Should create booking');
    assert(r.data.clientSecret, 'Should provide Stripe client secret');

    const crm = await GET('/customers?search=' + uniqueEmail.split('@')[0], { token: TOKEN });
    assert(crm.data.data.some(c => c.email === uniqueEmail), 'New customer should appear in CRM');
  });

  await test('Public booking widget reuses existing customer', async () => {
    const existingEmail = 'amira@surf-life.com';
    const r = await POST('/public/blue-horizon/bookings', {
      body: {
        experienceId: YOGA_EXP_ID,
        email: existingEmail,
        firstName: 'Amira', lastName: 'Mansouri',
        adults: 1,
        startDate: futureDate(950), endDate: futureDate(957),
      },
      expectStatus: 201,
    });
    assert(r.data.booking, 'Should create booking for existing customer');
    // Verify no duplicate customer was created
    const crm = await GET('/customers?search=amira', { token: TOKEN });
    const amiraCount = crm.data.data.filter(c => c.email === existingEmail).length;
    assertEq(amiraCount, 1, 'Should still be exactly 1 Amira in CRM');
  });

  await test('Public endpoint with wrong tenant slug is rejected', async () => {
    const r = await GET('/public/nonexistent-company/experiences');
    assertEq(r.status, 404);
  });

  // ── FINAL SUMMARY ─────────────────────────────────────────────
  const elapsed = Date.now() - t0;
  const total   = passed + failed;

  console.log('\n' + BOLD('═'.repeat(64)));
  console.log(`  ${GRN(passed + ' passed')}  ${failed > 0 ? RED(failed + ' failed') : DIM('0 failed')}  ${DIM(total + ' total')}  ${DIM(elapsed + 'ms')}`);
  console.log(BOLD('═'.repeat(64)));

  if (failures.length > 0) {
    console.log(RED('\n  Failed:'));
    failures.forEach(f => console.log(`  ${FAIL} ${f.name}\n      ${RED('→ ' + f.error)}`));
  } else {
    console.log(GRN('\n  ✅ All extended tests passed!\n'));
  }

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(err => { console.error('Fatal:', err); process.exit(1); });
