// ============================================================
// CUSTOMERS SERVICE
// ============================================================
import { db, uuid, now } from './database.mjs';
import crypto from 'crypto';

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export class CustomersService {
  create(tenantId, data) {
    if (!data.email || data.email.length > 254 || !validateEmail(data.email))
      throw Object.assign(new Error('Invalid email address'), { status: 400 });

    const existing = db.customers.findOne(c => c.tenant_id === tenantId && c.email === data.email);
    if (existing)
      throw Object.assign(new Error(`Customer with email ${data.email} already exists`), { status: 409 });

    return db.customers.insert({
      tenant_id: tenantId,
      email:     data.email,
      first_name: data.firstName,
      last_name:  data.lastName,
      phone:      data.phone ?? null,
      nationality: data.nationality ?? null,
      tags:       data.tags ?? [],
      notes:      data.notes ?? '',
      source:     data.source ?? 'direct',
      total_bookings: 0,
      total_spent: 0,
    });
  }

  findOrCreate(tenantId, data) {
    const existing = db.customers.findOne(c => c.tenant_id === tenantId && c.email === data.email);
    return existing ?? this.create(tenantId, data);
  }

  list(tenantId, { search, tags, source, page = 1, limit = 25 } = {}) {
    let rows = db.customers.find(c => c.tenant_id === tenantId);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(c =>
        c.first_name?.toLowerCase().includes(q) ||
        c.last_name?.toLowerCase().includes(q)  ||
        c.email?.toLowerCase().includes(q)
      );
    }
    if (tags?.length) rows = rows.filter(c => tags.every(t => c.tags?.includes(t)));
    if (source) rows = rows.filter(c => c.source === source);
    rows.sort((a, b) => (b.total_spent ?? 0) - (a.total_spent ?? 0));
    const total = rows.length;
    return { data: rows.slice((page-1)*limit, page*limit), meta: { total, page, limit, totalPages: Math.ceil(total/limit) } };
  }

  get(tenantId, id) {
    const c = db.customers.findOne(c => c.id === id && c.tenant_id === tenantId);
    if (!c) throw Object.assign(new Error('Customer not found'), { status: 404 });
    const bookings = db.bookings.find(b => b.customer_id === id && b.tenant_id === tenantId);
    return { ...c, bookings };
  }

  update(tenantId, id, patch) {
    const c = db.customers.findOne(c => c.id === id && c.tenant_id === tenantId);
    if (!c) throw Object.assign(new Error('Customer not found'), { status: 404 });
    const mapped = {};
    if (patch.firstName) mapped.first_name = patch.firstName;
    if (patch.lastName)  mapped.last_name  = patch.lastName;
    if (patch.phone)     mapped.phone      = patch.phone;
    if (patch.tags)      mapped.tags       = patch.tags;
    if (patch.notes)     mapped.notes      = patch.notes;
    return db.customers.update(id, mapped);
  }

  addTag(tenantId, id, tag) {
    const c = db.customers.findOne(c => c.id === id && c.tenant_id === tenantId);
    if (!c) throw Object.assign(new Error('Customer not found'), { status: 404 });
    const tags = [...new Set([...c.tags, tag])];
    return db.customers.update(id, { tags });
  }

  removeTag(tenantId, id, tag) {
    const c = db.customers.findOne(c => c.id === id && c.tenant_id === tenantId);
    if (!c) throw Object.assign(new Error('Customer not found'), { status: 404 });
    return db.customers.update(id, { tags: c.tags.filter(t => t !== tag) });
  }

  exportCsv(tenantId) {
    const customers = db.customers.find(c => c.tenant_id === tenantId);
    const headers = ['id','email','first_name','last_name','nationality','tags','source','total_bookings','total_spent','created_at'];
    const rows = customers.map(c => headers.map(h => {
      const v = h === 'tags' ? (c[h] ?? []).join(';') : (c[h] ?? '');
      return `"${String(v).replace(/"/g,'""')}"`;
    }).join(','));
    return [headers.join(','), ...rows].join('\n');
  }

  getStats(tenantId) {
    const all = db.customers.find(c => c.tenant_id === tenantId);
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return {
      total: all.length,
      returning: all.filter(c => c.total_bookings > 1).length,
      newThisMonth: all.filter(c => new Date(c.created_at) >= thirtyDaysAgo).length,
      retentionRate: all.length > 0 ? Math.round(all.filter(c => c.total_bookings > 1).length / all.length * 100) : 0,
      avgLifetimeValue: all.length > 0 ? Math.round(all.reduce((s,c) => s + (c.total_spent ?? 0), 0) / all.length) : 0,
      totalRevenue: all.reduce((s,c) => s + (c.total_spent ?? 0), 0),
    };
  }
}

export const customersService = new CustomersService();

// ============================================================
// PAYMENTS SERVICE
// ============================================================
export class PaymentsService {
  createPaymentRecord(tenantId, { bookingId, customerId, type, amount, currency, provider, isDeposit }) {
    const booking = db.bookings.findOne(b => b.id === bookingId && b.tenant_id === tenantId);
    if (!booking) throw Object.assign(new Error('Booking not found'), { status: 404 });
    if (amount <= 0) throw Object.assign(new Error('Amount must be positive'), { status: 400 });
    if (amount > (booking.total_amount - booking.paid_amount) + 0.01) {
      throw Object.assign(new Error('Amount exceeds balance due'), { status: 422 });
    }

    const payment = db.payments.insert({
      tenant_id:   tenantId,
      booking_id:  bookingId,
      customer_id: customerId ?? booking.customer_id,
      type:        type ?? (isDeposit ? 'deposit' : 'charge'),
      status:      'succeeded',
      amount,
      currency:    currency ?? booking.currency,
      provider:    provider ?? 'stripe',
      provider_payment_id: `pi_mock_${Date.now()}`,
      processed_at: now(),
    });

    // Update booking paid amount
    const newPaid = Math.round((booking.paid_amount + amount) * 100) / 100;
    const depositThreshold = booking.deposit_amount ?? Math.round(booking.total_amount * (booking.deposit_percent ?? 30) / 100 * 100) / 100;
    const newStatus = newPaid >= booking.total_amount
      ? 'fully_paid'
      : newPaid >= depositThreshold
      ? 'deposit_paid'
      : booking.status;
    db.bookings.update(bookingId, { paid_amount: newPaid, status: newStatus });

    // Update customer total_spent
    db.customers.update(booking.customer_id, {
      total_spent: (db.customers.findById(booking.customer_id)?.total_spent ?? 0) + amount,
    });

    return { payment, booking: db.bookings.findById(bookingId) };
  }

  refund(tenantId, { paymentId, amount, reason }) {
    const payment = db.payments.findOne(p => p.id === paymentId && p.tenant_id === tenantId);
    if (!payment) throw Object.assign(new Error('Payment not found'), { status: 404 });
    if (payment.status !== 'succeeded') throw Object.assign(new Error('Only succeeded payments can be refunded'), { status: 422 });
    if (amount <= 0) throw Object.assign(new Error('Refund amount must be positive'), { status: 400 });
    if (amount > payment.amount) throw Object.assign(new Error('Refund cannot exceed original payment'), { status: 422 });

    const refund = db.payments.insert({
      tenant_id:   tenantId,
      booking_id:  payment.booking_id,
      customer_id: payment.customer_id,
      type:        amount < payment.amount ? 'partial_refund' : 'refund',
      status:      'succeeded',
      amount:      -amount,
      currency:    payment.currency,
      provider:    payment.provider,
      provider_payment_id: `re_mock_${Date.now()}`,
      processed_at: now(),
      refund_reason: reason,
    });

    // Update booking
    const booking = db.bookings.findById(payment.booking_id);
    const newPaid = Math.max(0, Math.round((booking.paid_amount - amount) * 100) / 100);
    const newStatus = newPaid === 0 ? 'refunded' : booking.status;
    db.bookings.update(booking.id, { paid_amount: newPaid, status: newStatus });

    return refund;
  }

  list(tenantId, { bookingId, page = 1, limit = 25 } = {}) {
    let rows = db.payments.find(p => p.tenant_id === tenantId);
    if (bookingId) rows = rows.filter(p => p.booking_id === bookingId);
    rows.sort((a,b) => b.created_at.localeCompare(a.created_at));
    return { data: rows.slice((page-1)*limit, page*limit), meta: { total: rows.length, page, limit } };
  }

  // Simulate Stripe intent creation
  createStripeIntent({ bookingId, tenantId, amount, currency, isDeposit }) {
    return {
      clientSecret:    `pi_mock_${Date.now()}_secret_goboki`,
      paymentIntentId: `pi_mock_${Date.now()}`,
      amount:          Math.round(amount * 100), // cents
      currency:        (currency ?? 'USD').toLowerCase(),
      metadata:        { bookingId, tenantId, type: isDeposit ? 'deposit' : 'balance' },
    };
  }
}

export const paymentsService = new PaymentsService();

// ============================================================
// ANALYTICS SERVICE
// ============================================================
export class AnalyticsService {
  overview(tenantId) {
    const bookings = db.bookings.find(b => b.tenant_id === tenantId);
    const payments = db.payments.find(p => p.tenant_id === tenantId && p.status === 'succeeded' && p.amount > 0);
    const customers = db.customers.find(c => c.tenant_id === tenantId);
    const experiences = db.experiences.find(e => e.tenant_id === tenantId);

    const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);

    const now30  = new Date(); now30.setDate(now30.getDate() - 30);
    const now60  = new Date(); now60.setDate(now60.getDate() - 60);

    const thisMonth = payments.filter(p => new Date(p.processed_at) >= now30).reduce((s,p) => s+p.amount,0);
    const lastMonth = payments.filter(p => new Date(p.processed_at) >= now60 && new Date(p.processed_at) < now30).reduce((s,p) => s+p.amount,0);
    const revenueGrowth = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;

    const confirmed = bookings.filter(b => ['confirmed','deposit_paid','fully_paid','completed'].includes(b.status)).length;
    const pending   = bookings.filter(b => b.status === 'pending').length;
    const cancelled = bookings.filter(b => b.status === 'cancelled').length;
    const avgValue  = bookings.length > 0 ? Math.round(bookings.reduce((s,b) => s + b.total_amount, 0) / bookings.length) : 0;

    const totalCapacityDays = experiences.reduce((s,e) => s + e.max_capacity, 0);
    const bookedSlots = bookings.filter(b => !['cancelled','refunded'].includes(b.status)).reduce((s,b) => s + b.guests, 0);
    const occupancy = totalCapacityDays > 0 ? Math.round(bookedSlots / totalCapacityDays * 100) : 0;

    const newCustomers = customers.filter(c => new Date(c.created_at) >= now30).length;

    return {
      revenue:   { total: totalRevenue, thisMonth, lastMonth, growth: revenueGrowth, currency: 'USD' },
      bookings:  { total: bookings.length, confirmed, pending, cancelled, avgValue },
      occupancy: { overall: occupancy, target: 75, byExperience: experiences.map(e => ({
        name: e.name,
        rate: Math.round(db.bookings.find(b => b.experience_id === e.id && !['cancelled','refunded'].includes(b.status)).reduce((s,b)=>s+b.guests,0) / e.max_capacity * 100),
        capacity: e.max_capacity,
        booked: db.bookings.find(b => b.experience_id === e.id && !['cancelled','refunded'].includes(b.status)).reduce((s,b)=>s+b.guests,0),
      }))},
      customers: {
        total: customers.length,
        newThisMonth: newCustomers,
        returning: customers.filter(c => c.total_bookings > 1).length,
        retentionRate: customers.length > 0 ? Math.round(customers.filter(c => c.total_bookings > 1).length / customers.length * 100) : 0,
        avgLifetimeValue: customers.length > 0 ? Math.round(customers.reduce((s,c) => s + c.total_spent, 0) / customers.length) : 0,
      },
    };
  }

  topExperiences(tenantId, limit = 5) {
    const experiences = db.experiences.find(e => e.tenant_id === tenantId);
    return experiences.map(e => {
      const bookings = db.bookings.find(b => b.experience_id === e.id && !['cancelled','refunded'].includes(b.status));
      return {
        id: e.id, name: e.name, type: e.type,
        bookingCount: bookings.length,
        totalRevenue: bookings.reduce((s,b) => s + b.total_amount, 0),
        avgGroupSize: bookings.length > 0 ? Math.round(bookings.reduce((s,b) => s + b.guests, 0) / bookings.length * 10) / 10 : 0,
      };
    }).sort((a,b) => b.totalRevenue - a.totalRevenue).slice(0, limit);
  }
}

export const analyticsService = new AnalyticsService();

// ============================================================
// WEBHOOKS SERVICE
// ============================================================
export class WebhooksService {
  sign(payload, secret) {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const sig  = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    return { body, signature: sig };
  }

  verify(body, signature, secret) {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  async fire(tenantId, event, data) {
    const hooks = db.webhooks.find(w => w.tenant_id === tenantId && w.is_active && w.events.includes(event));
    const payload = { event, timestamp: now(), tenantId, id: uuid(), data };
    // In production: actually POST to each URL. Here we log and record.
    hooks.forEach(hook => {
      db.webhooks.update(hook.id, { last_fired: now() });
    });
    db.audit_logs.insert({ tenant_id: tenantId, action: `webhook.${event}`, entity_type: 'webhook', new_values: payload });
    return { fired: hooks.length, event, payload };
  }
}

export const webhooksService = new WebhooksService();
