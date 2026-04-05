# GOBOKI API Reference

**Base URL:** `https://api.goboki.com/v1`  
**Auth:** `Authorization: Bearer <access_token>` (15-min JWT)  
**Content-Type:** `application/json`

---

## Authentication

### POST `/auth/login`
```json
Request:  { "email": "string", "password": "string" }
Response: { "accessToken": "string", "refreshToken": "string", "expiresIn": 900 }
```

### POST `/auth/register`
```json
Request: {
  "businessName": "Blue Horizon Retreats",
  "slug": "blue-horizon",
  "email": "owner@example.com",
  "password": "SecurePass1!",
  "firstName": "Jordan",
  "lastName": "Davies"
}
Response: { "accessToken": "...", "refreshToken": "...", "expiresIn": 900 }
```

### POST `/auth/refresh`
```json
Request:  { "refreshToken": "string" }
Response: { "accessToken": "string", "refreshToken": "string", "expiresIn": 900 }
```

### GET `/auth/me`
Returns current user profile.

---

## Bookings

### GET `/bookings`
**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Per page, max 100 (default: 25) |
| `status` | string | `pending\|confirmed\|deposit_paid\|fully_paid\|cancelled\|refunded\|completed\|no_show` |
| `search` | string | Search by reference, name, email |
| `experienceId` | uuid | Filter by experience |
| `dateFrom` | date | `YYYY-MM-DD` |
| `dateTo` | date | `YYYY-MM-DD` |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "reference": "BK-2025-1024",
      "status": "confirmed",
      "customer": { "id": "uuid", "firstName": "Amira", "lastName": "Mansouri", "email": "..." },
      "experience": { "id": "uuid", "name": "7-Day Surf Retreat", "type": "retreat" },
      "startDate": "2025-08-12",
      "endDate": "2025-08-19",
      "guests": 2,
      "totalAmount": 2840.00,
      "paidAmount": 852.00,
      "balanceDue": 1988.00,
      "currency": "USD",
      "createdAt": "2025-07-15T10:30:00Z"
    }
  ],
  "meta": { "total": 127, "page": 1, "limit": 25, "totalPages": 6 }
}
```

### POST `/bookings`
```json
Request: {
  "customerId": "uuid",
  "experienceId": "uuid",
  "startDate": "2025-09-01",
  "endDate": "2025-09-08",
  "adults": 2,
  "children": 0,
  "specialRequests": "Vegetarian meals please",
  "depositPercent": 30,
  "source": "widget"
}
Response: { ...booking object... }
```
**Status:** `201 Created`

### GET `/bookings/:id`
Returns full booking with customer, experience, payments, guests.

### PATCH `/bookings/:id`
```json
Request: {
  "status": "confirmed",
  "internalNotes": "Called to confirm dietary requirements"
}
```

### DELETE `/bookings/:id`
Cancels booking. Body: `{ "reason": "Customer requested" }`  
**Status:** `204 No Content`

### GET `/bookings/calendar?year=2025&month=8`
Returns bookings for calendar view (start/end dates, experience name, guest count, status).

---

## Experiences

### GET `/experiences`
Returns all active experiences for the tenant.

### POST `/experiences`
```json
Request: {
  "name": "7-Day Surf Retreat",
  "slug": "7-day-surf-retreat",
  "type": "retreat",
  "description": "...",
  "basePrice": 1420.00,
  "currency": "USD",
  "durationDays": 7,
  "maxCapacity": 12,
  "maxGuests": 12,
  "location": { "country": "MA", "city": "Taghazout", "coordinates": { "lat": 30.53, "lng": -9.71 } },
  "inclusions": ["Airport transfer", "3 surf sessions/day", "Accommodation", "Breakfast & dinner"],
  "exclusions": ["Flights", "Travel insurance"]
}
```

### GET `/experiences/:id`
### PATCH `/experiences/:id`
### DELETE `/experiences/:id`

---

## Availability

### GET `/availability/check`
**Query params:** `experienceId`, `startDate`, `endDate`, `guests`
```json
Response: {
  "available": true,
  "remainingCapacity": 8,
  "price": 2840.00,
  "depositAmount": 852.00,
  "currency": "USD"
}
```

### GET `/availability/calendar?experienceId=uuid&year=2025&month=8`
Returns day-by-day availability for a calendar grid.
```json
Response: [
  { "date": "2025-08-12", "available": true, "capacity": 12, "booked": 4, "remaining": 8 },
  { "date": "2025-08-14", "available": false, "capacity": 12, "booked": 12, "remaining": 0 },
  ...
]
```

### POST `/availability/block`
```json
Request: {
  "experienceId": "uuid",
  "dates": ["2025-09-01", "2025-09-02"],
  "reason": "Staff training"
}
```

---

## Customers

### GET `/customers`
**Query params:** `page`, `limit`, `search`, `tags[]`

### POST `/customers`
```json
Request: {
  "email": "amira@example.com",
  "firstName": "Amira",
  "lastName": "Mansouri",
  "phone": "+212 661 234 567",
  "nationality": "MA",
  "tags": ["vip", "surf"],
  "source": "instagram"
}
```

### GET `/customers/:id`
Full profile with bookings, payments, notes.

### PATCH `/customers/:id`
### GET `/customers/:id/bookings`
### GET `/customers/:id/timeline`
Returns full activity timeline.

---

## Payments

### POST `/payments/stripe/intent`
```json
Request: {
  "bookingId": "uuid",
  "amount": 852.00,
  "currency": "USD",
  "isDeposit": true
}
Response: {
  "clientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_xxx"
}
```

### POST `/payments/stripe/webhook`
Receives Stripe events. Set endpoint to `https://api.goboki.com/v1/payments/stripe/webhook`.

### POST `/payments/paypal/order`
```json
Request: { "bookingId": "uuid", "amount": 2840.00, "currency": "USD" }
Response: { "orderId": "PAY-xxx", "approvalUrl": "https://paypal.com/..." }
```

### POST `/payments/paypal/capture`
```json
Request: { "orderId": "PAY-xxx", "bookingId": "uuid" }
Response: { ...payment record... }
```

### POST `/payments/refund`
```json
Request: {
  "paymentIntentId": "pi_xxx",
  "amount": 500.00,
  "reason": "requested_by_customer"
}
Response: { "refundId": "re_xxx", "amount": 500.00, "status": "succeeded" }
```

---

## Analytics

### GET `/analytics/overview`
Full dashboard metrics (revenue, bookings, occupancy, customers).

### GET `/analytics/revenue?year=2025`
Monthly revenue breakdown.

### GET `/analytics/occupancy`
Per-experience occupancy rates.

### GET `/analytics/top-experiences?limit=5`
Top experiences by revenue.

### GET `/analytics/sources`
Booking source breakdown (widget, direct, referral, API).

---

## Website Builder

### GET `/website/pages`
List all pages for the tenant's website.

### POST `/website/pages`
```json
Request: {
  "slug": "surf-retreats",
  "title": "Our Surf Retreats",
  "template": "experience_landing",
  "content": { "blocks": [...] },
  "seoTitle": "World-Class Surf Retreats | Blue Horizon",
  "seoDesc": "..."
}
```

### PATCH `/website/pages/:id`
### POST `/website/pages/:id/publish`
### GET `/website/settings`
Returns global site settings (logo, colors, nav, footer).

---

## Webhooks

### GET `/webhooks`
List configured webhooks.

### POST `/webhooks`
```json
Request: {
  "url": "https://hooks.zapier.com/...",
  "events": ["booking.created", "booking.cancelled", "payment.received"]
}
```
Available events:
- `booking.created`, `booking.confirmed`, `booking.cancelled`, `booking.completed`
- `payment.received`, `payment.refunded`, `payment.failed`
- `customer.created`

### DELETE `/webhooks/:id`

---

## Error Responses

All errors follow this format:
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    { "field": "startDate", "message": "startDate must be a valid date string" }
  ],
  "timestamp": "2025-08-12T10:30:00Z",
  "path": "/api/v1/bookings"
}
```

| Status | Meaning |
|--------|---------|
| `400` | Bad Request — validation error |
| `401` | Unauthorized — missing or invalid token |
| `403` | Forbidden — insufficient role |
| `404` | Not Found |
| `409` | Conflict — e.g. duplicate email |
| `422` | Unprocessable — e.g. no availability |
| `429` | Too Many Requests — rate limited |
| `500` | Internal Server Error |

---

## Rate Limits

| Window | Limit |
|--------|-------|
| 1 second | 20 requests |
| 10 seconds | 100 requests |
| 1 minute | 300 requests |

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## Public Booking Widget API

These endpoints require **tenant slug** instead of JWT (public-facing):

### GET `/public/:tenantSlug/experiences`
### GET `/public/:tenantSlug/experiences/:slug`
### GET `/public/:tenantSlug/availability`
### POST `/public/:tenantSlug/bookings` — creates booking + Stripe intent
