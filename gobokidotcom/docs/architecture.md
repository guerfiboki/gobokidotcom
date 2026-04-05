# GOBOKI — Architecture Overview

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         GOBOKI Platform                              │
│                                                                      │
│  ┌─────────────────┐    ┌──────────────────────────────────────────┐│
│  │   Public Widget  │    │         Admin SPA (Next.js)             ││
│  │  (Embeddable JS) │    │  Dashboard · Bookings · CRM · Payments  ││
│  └────────┬─────────┘    └──────────────┬───────────────────────────┘│
│           │                             │                            │
│           └──────────────┬──────────────┘                           │
│                          │ HTTPS / REST API                         │
│  ┌───────────────────────▼──────────────────────────────────────┐   │
│  │                    API Gateway (AWS ALB)                      │   │
│  │              Rate limiting · SSL termination                  │   │
│  └───────────────────────┬──────────────────────────────────────┘   │
│                          │                                          │
│  ┌───────────────────────▼──────────────────────────────────────┐   │
│  │                NestJS Application (ECS)                       │   │
│  │                                                              │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │   │
│  │  │   Auth   │ │Bookings  │ │Payments  │ │  Experiences   │  │   │
│  │  │  Module  │ │  Module  │ │  Module  │ │    Module      │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────────────┘  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │   │
│  │  │Customers │ │Analytics │ │  Website │ │  Notifications │  │   │
│  │  │  Module  │ │  Module  │ │  Module  │ │    Module      │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────────────┘  │   │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  PostgreSQL  │  │    Redis     │  │   Bull Queue │              │
│  │   (AWS RDS)  │  │(ElastiCache) │  │ (Email/Jobs) │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└──────────────────────────────────────────────────────────────────────┘
```

## Multi-Tenancy Strategy

GOBOKI uses **shared database, separate schema** via `tenant_id` column:

- Every table has a `tenant_id` column
- All queries filter by `tenant_id` (enforced via `TenantGuard`)
- Row-level security (RLS) as a second safety layer
- Each tenant gets their own subdomain: `{slug}.goboki.com`

```
tenants
  └── users (staff of tenant)
  └── experiences (products offered)
  └── customers (CRM)
  └── bookings → booking_guests, booking_addons
  └── payments → invoices
  └── email_templates
  └── website_pages
  └── webhooks
```

## Authentication Flow

```
1. POST /auth/login (email + password)
   └── Validate credentials → return { accessToken (15min), refreshToken (30d) }

2. Client stores tokens in memory (accessToken) + httpOnly cookie (refreshToken)

3. Every API request: Authorization: Bearer <accessToken>

4. On 401: POST /auth/refresh → new token pair (silent refresh)

5. Google OAuth flow:
   GET /auth/google → redirect to Google
   GET /auth/google/callback → find/create user → return tokens
```

## Booking Flow

```
Guest (Widget)
  │
  ├─ 1. GET /public/{slug}/experiences  ──→ list available products
  │
  ├─ 2. GET /availability/check         ──→ verify dates + price
  │
  ├─ 3. POST /public/{slug}/bookings    ──→ create booking (status: pending)
  │       └── find_or_create customer
  │       └── calculate_price (rules engine)
  │       └── create Stripe PaymentIntent
  │       └── return { booking, clientSecret }
  │
  ├─ 4. Stripe Elements → confirmPayment()
  │
  └─ 5. Stripe webhook → payment_intent.succeeded
          └── update booking status → deposit_paid / fully_paid
          └── update customer.total_spent
          └── queue: send confirmation email
          └── queue: schedule deposit reminder
          └── queue: schedule pre-arrival email (-3 days)
          └── fire webhooks to Zapier/integrations
```

## Payment Flow

```
Stripe (primary):
  PaymentIntent → client-side Stripe Elements → webhook confirms

PayPal:
  Create Order → redirect to PayPal → capture on return → webhook

Deposit Logic:
  - Default: 30% due at booking, 70% 30 days before arrival
  - Configurable per tenant (settings.depositPercent)
  - Automatic reminders via Bull queue
```

## Email Automation

```
Trigger                    Template              Delay
─────────────────────────────────────────────────────
booking.created         → booking_confirmed     immediately
payment.received        → payment_receipt       immediately
booking.confirmed       → balance_reminder      when balance due - 7 days
booking.confirmed       → pre_arrival           arrival - 3 days
booking.completed       → review_request        +2 days after checkout
custom                  → custom template       configurable
```

## Pricing Rules Engine

```
Priority order (applied sequentially):
1. Base price (experience.basePrice × guests)
2. Seasonal rules (date range overrides)
3. Group discounts (min/max guest count)
4. Early bird discounts (booked X days in advance)
5. Add-ons (equipment, transfers, meals)

Each rule: { type, modifier_op, value, conditions }
modifier_op: replace | add | subtract | multiply
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API style | REST | Broad tooling, simpler for 3rd party integrations |
| Auth | JWT + refresh | Stateless, scales horizontally |
| Queue | Bull (Redis) | Reliable, delay support for scheduled emails |
| ORM | TypeORM | Good PostgreSQL support, decorators fit NestJS |
| Multi-tenancy | Shared DB, tenant_id | Cost-effective, simpler to manage at this scale |
| Payments | Stripe primary + PayPal | Market coverage; Stripe Elements for PCI compliance |
| Email | Resend | Modern API, better deliverability than SMTP |
| Frontend | Next.js App Router | SSR for SEO, React Server Components for performance |
| State | Zustand + React Query | Lightweight; server state separate from UI state |
