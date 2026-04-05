// ============================================================
// GOBOKI HTTP ROUTER — REST API
// Pure Node.js http module, no frameworks
// ============================================================
import { createServer } from 'http';
import { URL } from 'url';
import { authService, verifyJwt, hasPermission } from './auth.mjs';
import { experiencesService, checkAvailability } from './experiences.mjs';
import { bookingsService } from './bookings.mjs';
import { customersService, paymentsService, analyticsService, webhooksService } from './services.mjs';
import { db } from './database.mjs';

// ── Response helpers ──────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data, null, 2));
}

function error(res, message, status = 400) {
  json(res, { error: message, statusCode: status, timestamp: new Date().toISOString() }, status);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) reject(new Error('Body too large')); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// ── Auth middleware ───────────────────────────────────────────
function authenticate(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) throw Object.assign(new Error('Missing Authorization header'), { status: 401 });
  return verifyJwt(auth.slice(7));
}

function requireRole(user, permission) {
  if (!hasPermission(user.role, permission)) {
    throw Object.assign(new Error(`Forbidden: requires '${permission}'`), { status: 403 });
  }
}

// ── Route handler ─────────────────────────────────────────────
async function handle(req, res) {
  const url    = new URL(req.url, `http://${req.headers.host}`);
  const path   = url.pathname.replace(/^\/api\/v1/, '');
  const method = req.method;
  const q      = Object.fromEntries(url.searchParams);

  // OPTIONS (CORS preflight)
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
    return res.end();
  }

  try {
    // ── Health check ──────────────────────────────────────────
    if (path === '/health' && method === 'GET') {
      return json(res, {
        status: 'ok', service: 'GOBOKI API', version: '1.0.0',
        timestamp: new Date().toISOString(),
        db: {
          tenants: db.tenants.count(), users: db.users.count(),
          experiences: db.experiences.count(), customers: db.customers.count(),
          bookings: db.bookings.count(), payments: db.payments.count(),
        },
      });
    }

    // ── AUTH ─────────────────────────────────────────────────
    if (path === '/auth/login' && method === 'POST') {
      const { email, password } = await readBody(req);
      if (!email || !password) return error(res, 'email and password required');
      return json(res, authService.login(email, password));
    }

    if (path === '/auth/refresh' && method === 'POST') {
      const { refreshToken } = await readBody(req);
      if (!refreshToken) return error(res, 'refreshToken required');
      return json(res, authService.refresh(refreshToken));
    }

    if (path === '/auth/me' && method === 'GET') {
      const auth = req.headers.authorization?.slice(7);
      if (!auth) return error(res, 'Unauthorized', 401);
      return json(res, authService.me(auth));
    }

    // ── EXPERIENCES ───────────────────────────────────────────
    if (path === '/experiences' && method === 'GET') {
      const user = authenticate(req);
      return json(res, experiencesService.list(user.tenantId));
    }

    if (path.match(/^\/experiences\/[^/]+$/) && method === 'GET') {
      const user = authenticate(req);
      const id = path.split('/')[2];
      if (q.year && q.month) {
        return json(res, experiencesService.getCalendar(user.tenantId, id, parseInt(q.year), parseInt(q.month)));
      }
      return json(res, experiencesService.get(user.tenantId, id));
    }

    if (path === '/experiences' && method === 'POST') {
      const user = authenticate(req);
      requireRole(user, 'experiences:create');
      const body = await readBody(req);
      return json(res, experiencesService.create(user.tenantId, body), 201);
    }

    if (path.match(/^\/experiences\/[^/]+$/) && method === 'PATCH') {
      const user = authenticate(req);
      requireRole(user, 'experiences:update');
      const id   = path.split('/')[2];
      const body = await readBody(req);
      return json(res, experiencesService.update(user.tenantId, id, body));
    }

    // ── AVAILABILITY ──────────────────────────────────────────
    if (path === '/availability/check' && method === 'GET') {
      const user = authenticate(req);
      const { experienceId, startDate, endDate, guests } = q;
      if (!experienceId || !startDate || !endDate || !guests)
        return error(res, 'experienceId, startDate, endDate, guests required');
      return json(res, checkAvailability({ experienceId, tenantId: user.tenantId, startDate, endDate, guests: parseInt(guests) }));
    }

    // ── BOOKINGS ──────────────────────────────────────────────
    if (path === '/bookings' && method === 'GET') {
      const user = authenticate(req);
      return json(res, bookingsService.list(user.tenantId, {
        status: q.status, search: q.search, experienceId: q.experienceId,
        dateFrom: q.dateFrom, dateTo: q.dateTo,
        page: parseInt(q.page) || 1, limit: parseInt(q.limit) || 25,
      }));
    }

    if (path === '/bookings' && method === 'POST') {
      const user = authenticate(req);
      const body = await readBody(req);
      return json(res, bookingsService.create(user.tenantId, body), 201);
    }

    if (path === '/bookings/calendar' && method === 'GET') {
      const user = authenticate(req);
      return json(res, bookingsService.getCalendar(user.tenantId, parseInt(q.year), parseInt(q.month)));
    }

    if (path.match(/^\/bookings\/[^/]+$/) && method === 'GET') {
      const user = authenticate(req);
      const id   = path.split('/')[2];
      return json(res, bookingsService.get(user.tenantId, id));
    }

    if (path.match(/^\/bookings\/[^/]+$/) && method === 'PATCH') {
      const user = authenticate(req);
      const id   = path.split('/')[2];
      const body = await readBody(req);
      if (!body.status) return error(res, 'status required');
      return json(res, bookingsService.updateStatus(user.tenantId, id, body.status, body.reason));
    }

    if (path.match(/^\/bookings\/[^/]+$/) && method === 'DELETE') {
      const user = authenticate(req);
      const id   = path.split('/')[2];
      const body = await readBody(req);
      return json(res, bookingsService.updateStatus(user.tenantId, id, 'cancelled', body.reason), 200);
    }

    // ── CUSTOMERS ─────────────────────────────────────────────
    if (path === '/customers' && method === 'GET') {
      const user = authenticate(req);
      return json(res, customersService.list(user.tenantId, {
        search: q.search, tags: q.tags?.split(',').filter(Boolean),
        source: q.source, page: parseInt(q.page)||1, limit: parseInt(q.limit)||25,
      }));
    }

    if (path === '/customers' && method === 'POST') {
      const user = authenticate(req);
      const body = await readBody(req);
      return json(res, customersService.create(user.tenantId, body), 201);
    }

    if (path === '/customers/stats' && method === 'GET') {
      const user = authenticate(req);
      return json(res, customersService.getStats(user.tenantId));
    }

    if (path === '/customers/export' && method === 'GET') {
      const user = authenticate(req);
      const csv = customersService.exportCsv(user.tenantId);
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="customers.csv"' });
      return res.end(csv);
    }

    if (path.match(/^\/customers\/[^/]+$/) && method === 'GET') {
      const user = authenticate(req);
      const id   = path.split('/')[2];
      return json(res, customersService.get(user.tenantId, id));
    }

    if (path.match(/^\/customers\/[^/]+$/) && method === 'PATCH') {
      const user = authenticate(req);
      const id   = path.split('/')[2];
      const body = await readBody(req);
      return json(res, customersService.update(user.tenantId, id, body));
    }

    if (path.match(/^\/customers\/[^/]+\/tags$/) && method === 'POST') {
      const user = authenticate(req);
      const id   = path.split('/')[2];
      const { tag } = await readBody(req);
      if (!tag) return error(res, 'tag required');
      return json(res, customersService.addTag(user.tenantId, id, tag));
    }

    if (path.match(/^\/customers\/[^/]+\/tags\/[^/]+$/) && method === 'DELETE') {
      const user = authenticate(req);
      const [,, id,, tag] = path.split('/');
      return json(res, customersService.removeTag(user.tenantId, id, tag));
    }

    // ── PAYMENTS ──────────────────────────────────────────────
    if (path === '/payments' && method === 'GET') {
      const user = authenticate(req);
      return json(res, paymentsService.list(user.tenantId, { bookingId: q.bookingId }));
    }

    if (path === '/payments/charge' && method === 'POST') {
      const user = authenticate(req);
      const body = await readBody(req);
      if (!body.bookingId || !body.amount) return error(res, 'bookingId and amount required');
      return json(res, paymentsService.createPaymentRecord(user.tenantId, body), 201);
    }

    if (path === '/payments/stripe/intent' && method === 'POST') {
      const user = authenticate(req);
      const body = await readBody(req);
      return json(res, paymentsService.createStripeIntent({ ...body, tenantId: user.tenantId }));
    }

    if (path === '/payments/refund' && method === 'POST') {
      const user = authenticate(req);
      const rawBody = await readBody(req);
      const paymentId = rawBody.paymentId || rawBody.payment_id;
      if (!paymentId || !rawBody.amount) return error(res, 'paymentId and amount required');
      return json(res, paymentsService.refund(user.tenantId, { ...rawBody, paymentId }));
    }

    // ── ANALYTICS ─────────────────────────────────────────────
    if (path === '/analytics/overview' && method === 'GET') {
      const user = authenticate(req);
      return json(res, analyticsService.overview(user.tenantId));
    }

    if (path === '/analytics/top-experiences' && method === 'GET') {
      const user = authenticate(req);
      return json(res, analyticsService.topExperiences(user.tenantId, parseInt(q.limit) || 5));
    }

    // ── WEBHOOKS ──────────────────────────────────────────────
    if (path === '/webhooks/test' && method === 'POST') {
      const user = authenticate(req);
      const { event = 'booking.confirmed', data = {} } = await readBody(req);
      return json(res, await webhooksService.fire(user.tenantId, event, data));
    }

    if (path === '/webhooks/sign' && method === 'POST') {
      const { payload, secret } = await readBody(req);
      return json(res, webhooksService.sign(payload, secret || 'goboki-webhook-secret'));
    }

    // ── PUBLIC BOOKING ────────────────────────────────────────
    if (path.match(/^\/public\/[^/]+\/experiences$/) && method === 'GET') {
      const slug   = path.split('/')[2];
      const tenant = db.tenants.findOne(t => t.slug === slug);
      if (!tenant) return error(res, 'Tenant not found', 404);
      return json(res, experiencesService.list(tenant.id));
    }

    if (path.match(/^\/public\/[^/]+\/availability$/) && method === 'GET') {
      const slug   = path.split('/')[2];
      const tenant = db.tenants.findOne(t => t.slug === slug);
      if (!tenant) return error(res, 'Tenant not found', 404);
      const { experienceId, startDate, endDate, guests } = q;
      return json(res, checkAvailability({ experienceId, tenantId: tenant.id, startDate, endDate, guests: parseInt(guests)||1 }));
    }

    if (path.match(/^\/public\/[^/]+\/bookings$/) && method === 'POST') {
      const slug   = path.split('/')[2];
      const tenant = db.tenants.findOne(t => t.slug === slug);
      if (!tenant) return error(res, 'Tenant not found', 404);
      const body   = await readBody(req);
      // Find or create customer
      const customer = customersService.findOrCreate(tenant.id, {
        email: body.email, firstName: body.firstName, lastName: body.lastName,
        phone: body.phone, source: 'widget',
      });
      const booking = bookingsService.create(tenant.id, { ...body, customerId: customer.id, source: 'widget' });
      const intent  = paymentsService.createStripeIntent({
        bookingId: booking.id, tenantId: tenant.id,
        amount: booking.deposit_amount, currency: booking.currency, isDeposit: true,
      });
      return json(res, { booking, clientSecret: intent.clientSecret }, 201);
    }

    // ── 404 ───────────────────────────────────────────────────
    return error(res, `Route not found: ${method} ${path}`, 404);

  } catch (err) {
    const status = err.status ?? 500;
    if (status === 500) console.error('Unhandled error:', err);
    return error(res, err.message, status);
  }
}

export function createGobokiServer() {
  return createServer(handle);
}
