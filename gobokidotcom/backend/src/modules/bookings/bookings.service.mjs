// ============================================================
// BOOKINGS SERVICE — Full lifecycle, state machine
// ============================================================
import { db, uuid, now } from './database.mjs';
import { checkAvailability } from './experiences.mjs';

// ── Status state machine ──────────────────────────────────────
const VALID_TRANSITIONS = {
  pending:      ['confirmed', 'cancelled'],
  confirmed:    ['deposit_paid', 'cancelled'],
  deposit_paid: ['fully_paid', 'cancelled', 'refunded'],
  fully_paid:   ['completed', 'refunded', 'no_show'],
  completed:    [],
  cancelled:    ['refunded'],
  refunded:     [],
  no_show:      ['refunded'],
};

function canTransition(from, to) {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

// ── Reference generator ───────────────────────────────────────
function generateReference(tenantId) {
  const year  = new Date().getFullYear();
  const count = db.bookings.count(b => b.tenant_id === tenantId) + 1;
  return `BK-${year}-${String(count).padStart(4, '0')}`;
}

// ── Validation ────────────────────────────────────────────────
function validateDates(startDate, endDate) {
  const start = new Date(startDate);
  const end   = new Date(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (isNaN(start.getTime())) throw Object.assign(new Error('Invalid startDate'), { status: 400 });
  if (isNaN(end.getTime()))   throw Object.assign(new Error('Invalid endDate'), { status: 400 });
  if (start <= today) throw Object.assign(new Error('startDate must be a future date'), { status: 400 });
  if (end <= start)   throw Object.assign(new Error('endDate must be after startDate'), { status: 400 });
}

// ── BookingsService ───────────────────────────────────────────
export class BookingsService {
  create(tenantId, dto) {
    // Validate
    validateDates(dto.startDate, dto.endDate);
    if ((dto.adults ?? 1) < 1) throw Object.assign(new Error('adults must be at least 1'), { status: 400 });
    if (!dto.customerId)   throw Object.assign(new Error('customerId required'), { status: 400 });
    if (!dto.experienceId) throw Object.assign(new Error('experienceId required'), { status: 400 });

    const customer   = db.customers.findOne(c => c.id === dto.customerId && c.tenant_id === tenantId);
    if (!customer)  throw Object.assign(new Error('Customer not found'), { status: 404 });

    const experience = db.experiences.findById(dto.experienceId);
    if (!experience) throw Object.assign(new Error('Experience not found'), { status: 404 });

    const guests = (dto.adults ?? 1) + (dto.children ?? 0);

    // Availability check
    const avail = checkAvailability({
      experienceId: dto.experienceId,
      tenantId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      guests,
    });
    if (!avail.available) {
      throw Object.assign(
        new Error(`No availability: ${avail.errors?.[0]?.reason ?? 'Fully booked'}`),
        { status: 422 }
      );
    }

    const depositPercent = dto.depositPercent ?? 30;
    const totalAmount    = avail.subtotal;
    const depositAmount  = Math.round(totalAmount * depositPercent / 100 * 100) / 100;

    // Balance due date = 30 days before check-in
    const checkIn         = new Date(dto.startDate);
    const balanceDueDate  = new Date(checkIn);
    balanceDueDate.setDate(balanceDueDate.getDate() - 30);

    const booking = db.bookings.insert({
      tenant_id:        tenantId,
      reference:        generateReference(tenantId),
      customer_id:      dto.customerId,
      experience_id:    dto.experienceId,
      status:           'pending',
      start_date:       dto.startDate,
      end_date:         dto.endDate,
      guests,
      adults:           dto.adults ?? 1,
      children:         dto.children ?? 0,
      base_amount:      totalAmount,
      discount_amount:  avail.appliedRules.length > 0 ? 0 : 0, // simplified
      tax_amount:       0,
      total_amount:     totalAmount,
      paid_amount:      0,
      currency:         experience.currency,
      deposit_percent:  depositPercent,
      deposit_amount:   depositAmount,
      balance_due_date: balanceDueDate.toISOString().split('T')[0],
      special_requests: dto.specialRequests,
      source:           dto.source ?? 'api',
      applied_rules:    avail.appliedRules,
    });

    // Enrich response
    return {
      ...booking,
      customer,
      experience,
      balanceDue: totalAmount - booking.paid_amount,
      pricing: {
        pricePerPerson: avail.pricePerPerson,
        subtotal: avail.subtotal,
        depositAmount,
        appliedRules: avail.appliedRules,
      },
    };
  }

  list(tenantId, { status, search, experienceId, dateFrom, dateTo, page = 1, limit = 25 } = {}) {
    let rows = db.bookings.find(b => b.tenant_id === tenantId);

    if (status)      rows = rows.filter(b => b.status === status);
    if (experienceId) rows = rows.filter(b => b.experience_id === experienceId);
    if (dateFrom)    rows = rows.filter(b => b.start_date >= dateFrom);
    if (dateTo)      rows = rows.filter(b => b.start_date <= dateTo);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(b => {
        const c = db.customers.findById(b.customer_id);
        return b.reference.toLowerCase().includes(q)
          || c?.email?.toLowerCase().includes(q)
          || `${c?.first_name} ${c?.last_name}`.toLowerCase().includes(q);
      });
    }

    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const total = rows.length;
    const data  = rows.slice((page - 1) * limit, page * limit).map(b => this._enrich(b));
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  get(tenantId, id) {
    const b = db.bookings.findOne(b => b.id === id && b.tenant_id === tenantId);
    if (!b) throw Object.assign(new Error('Booking not found'), { status: 404 });
    return this._enrich(b, true);
  }

  updateStatus(tenantId, id, newStatus, reason) {
    const b = db.bookings.findOne(b => b.id === id && b.tenant_id === tenantId);
    if (!b) throw Object.assign(new Error('Booking not found'), { status: 404 });
    if (!canTransition(b.status, newStatus)) {
      throw Object.assign(
        new Error(`Cannot transition from '${b.status}' to '${newStatus}'`),
        { status: 422 }
      );
    }
    const patch = { status: newStatus };
    if (newStatus === 'cancelled') {
      patch.cancelled_at  = now();
      patch.cancel_reason = reason;
    }
    return this._enrich(db.bookings.update(id, patch));
  }

  getCalendar(tenantId, year, month) {
    const start = `${year}-${String(month).padStart(2,'0')}-01`;
    const end   = `${year}-${String(month).padStart(2,'0')}-${new Date(year,month,0).getDate()}`;
    return db.bookings.find(
      b => b.tenant_id === tenantId
        && !['cancelled','refunded'].includes(b.status)
        && b.start_date <= end && b.end_date >= start
    ).map(b => this._enrich(b));
  }

  _enrich(b, full = false) {
    const customer   = db.customers.findById(b.customer_id);
    const experience = db.experiences.findById(b.experience_id);
    const payments   = full ? db.payments.find(p => p.booking_id === b.id) : undefined;
    return {
      ...b,
      balanceDue: Math.round((b.total_amount - b.paid_amount) * 100) / 100,
      customer:   customer ? { id: customer.id, firstName: customer.first_name, lastName: customer.last_name, email: customer.email } : null,
      experience: experience ? { id: experience.id, name: experience.name, type: experience.type, location: experience.location } : null,
      ...(payments ? { payments } : {}),
    };
  }
}

export const bookingsService = new BookingsService();
