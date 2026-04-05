# GOBOKI — Travel Business SaaS Platform

> An all-in-one booking & operations platform for tour operators, retreat centers, camps and experience providers. Inspired by Bookinglayer.

---

## 🗂 Monorepo Structure

```
goboki/
├── frontend/          # Next.js 14 App Router
├── backend/           # NestJS REST API
├── database/          # PostgreSQL migrations & seeds
└── docs/              # API docs & architecture
```

## 🚀 Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-org/goboki.git
cd goboki

# 2. Start infrastructure
docker-compose up -d   # PostgreSQL + Redis

# 3. Backend
cd backend
cp .env.example .env   # fill in secrets
npm install
npm run migration:run
npm run seed
npm run start:dev      # http://localhost:3001

# 4. Frontend
cd ../frontend
cp .env.example .env.local
npm install
npm run dev            # http://localhost:3000
```

## 🧩 Core Features

| Module | Description |
|---|---|
| **Booking Engine** | Public widget, real-time availability, multi-product |
| **Reservation Dashboard** | Admin panel, drag-drop calendar, status management |
| **Customer CRM** | Profiles, history, tags, automated comms |
| **Payments** | Stripe + PayPal, deposits, invoices, refunds |
| **Website Builder** | No-code pages, embeddable widgets, SEO |
| **Automation** | Email/SMS triggers, Zapier webhooks |
| **Multi-Tenant** | Isolated workspaces, subscription tiers |

## 🏗 Tech Stack

- **Frontend**: Next.js 14, TailwindCSS, React Query, Zustand
- **Backend**: NestJS, TypeORM, PostgreSQL, Redis, Bull
- **Auth**: JWT + OAuth2 (Google), RBAC
- **Payments**: Stripe SDK, PayPal SDK
- **Email**: Resend / SendGrid
- **Storage**: AWS S3
- **Infra**: Vercel (frontend), AWS ECS (backend), RDS PostgreSQL

## 📖 Docs

- [API Reference](./docs/api-reference.md)
- [Database Schema](./docs/database-schema.md)
- [Architecture](./docs/architecture.md)
- [Deployment Guide](./docs/deployment.md)
