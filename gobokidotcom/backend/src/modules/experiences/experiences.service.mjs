// ============================================================
// EXPERIENCES, PRICING ENGINE & AVAILABILITY
// ============================================================
import { db, uuid, now } from './database.mjs';

// ── Pricing Engine ────────────────────────────────────────────
export function calculatePrice({ basePrice, guests, rules = [], startDate }) {
  let pricePerPerson = basePrice;
  const appliedRules = [];

  for (const rule of rules) {
    if (!rule.is_active) continue;
    if (rule.valid_from && startDate < rule.valid_from) continue;
    if (rule.valid_to   && startDate > rule.valid_to)   continue;
    if (rule.min_guests && guests < rule.min_guests) continue;
    if (rule.max_guests && guests > rule.max_guests) continue;

    switch (rule.modifier_op) {
      case 'replace':  pricePerPerson = rule.price_modifier; break;
      case 'add':      pricePerPerson += rule.price_modifier; break;
      case 'subtract': pricePerPerson -= rule.price_modifier; break;
      case 'multiply': pricePerPerson *= rule.percent_modifier / 100; break;
    }
    pricePerPerson = Math.max(0, pricePerPerson);
    appliedRules.push(rule.name);
  }

  const subtotal      = Math.round(pricePerPerson * guests * 100) / 100;
  const depositAmount = Math.round(subtotal * 0.30 * 100) / 100;
  const balanceDue    = Math.round((subtotal - depositAmount) * 100) / 100;

  return { pricePerPerson, subtotal, depositAmount, balanceDue, appliedRules };
}

// ── Availability Engine ───────────────────────────────────────
export function daysInRange(startDate, endDate) {
  const days = [];
  const cur = new Date(startDate);
  const end = new Date(endDate);
  while (cur < end) {
    days.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export function checkAvailability({ experienceId, tenantId, startDate, endDate, guests }) {
  const exp = db.experiences.findById(experienceId);
  if (!exp) throw Object.assign(new Error('Experience not found'), { status: 404 });
  if (guests > exp.max_capacity) {
    return { available: false, reason: `Max capacity is ${exp.max_capacity}`, remainingCapacity: 0 };
  }

  const days = daysInRange(startDate, endDate);
  const errors = [];

  for (const day of days) {
    // Check blocked dates
    const blocked = db.availability.findOne(
      a => a.experience_id === experienceId && a.date === day && a.is_blocked
    );
    if (blocked) { errors.push({ date: day, reason: blocked.block_reason || 'Blocked' }); continue; }

    // Count booked guests that day
    const bookedGuests = db.bookings.find(
      b => b.experience_id === experienceId
        && b.tenant_id === tenantId
        && !['cancelled', 'refunded'].includes(b.status)
        && b.start_date <= day && b.end_date > day
    ).reduce((sum, b) => sum + b.guests, 0);

    const remaining = exp.max_capacity - bookedGuests;
    if (remaining < guests) {
      errors.push({ date: day, reason: `Only ${remaining} spot(s) left`, remaining });
    }
  }

  // Get pricing
  const rules = db.pricing_rules.find(
    r => r.experience_id === experienceId && r.is_active
  );
  const pricing = calculatePrice({ basePrice: exp.base_price, guests, rules, startDate });

  return {
    available: errors.length === 0,
    errors,
    experience: { id: exp.id, name: exp.name, durationDays: exp.duration_days },
    ...pricing,
    currency: exp.currency,
  };
}

// ── ExperiencesService ────────────────────────────────────────
export class ExperiencesService {
  list(tenantId, { activeOnly = true } = {}) {
    return db.experiences.find(
      e => e.tenant_id === tenantId && (!activeOnly || e.is_active)
    );
  }

  get(tenantId, id) {
    const exp = db.experiences.findOne(e => e.id === id && e.tenant_id === tenantId);
    if (!exp) throw Object.assign(new Error('Experience not found'), { status: 404 });
    const rules = db.pricing_rules.find(r => r.experience_id === id);
    return { ...exp, pricingRules: rules };
  }

  create(tenantId, data) {
    const existing = db.experiences.findOne(
      e => e.tenant_id === tenantId && e.slug === data.slug
    );
    if (existing) throw Object.assign(new Error(`Slug '${data.slug}' already exists`), { status: 409 });

    return db.experiences.insert({ ...data, tenant_id: tenantId, is_active: true });
  }

  update(tenantId, id, patch) {
    const exp = db.experiences.findOne(e => e.id === id && e.tenant_id === tenantId);
    if (!exp) throw Object.assign(new Error('Experience not found'), { status: 404 });
    return db.experiences.update(id, patch);
  }

  getCalendar(tenantId, experienceId, year, month) {
    const exp = db.experiences.findOne(e => e.id === experienceId && e.tenant_id === tenantId);
    if (!exp) throw Object.assign(new Error('Experience not found'), { status: 404 });

    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = `${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;
      const blocked = db.availability.findOne(
        a => a.experience_id === experienceId && a.date === day && a.is_blocked
      );
      const booked = db.bookings.find(
        b => b.experience_id === experienceId
          && b.tenant_id === tenantId
          && !['cancelled','refunded'].includes(b.status)
          && b.start_date <= day && b.end_date > day
      ).reduce((s, b) => s + b.guests, 0);

      const remaining = Math.max(0, exp.max_capacity - booked);
      return {
        date: day,
        booked,
        remaining,
        isBlocked: !!blocked,
        available: !blocked && remaining > 0,
        pctFull: Math.round((booked / exp.max_capacity) * 100),
      };
    });
  }
}

export const experiencesService = new ExperiencesService();
