# GOBOKI Deployment Guide

## Environment Variables

### Backend `.env`
```bash
# Server
NODE_ENV=production
PORT=3001
CLIENT_URL=https://app.goboki.com

# Database
DB_HOST=goboki-db.xxxxx.rds.amazonaws.com
DB_PORT=5432
DB_USER=goboki_user
DB_PASS=your-secure-password
DB_NAME=goboki
DB_SSL=true

# Redis
REDIS_HOST=goboki-redis.xxxxx.cache.amazonaws.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# JWT
JWT_SECRET=minimum-32-char-random-secret-here
JWT_REFRESH_SECRET=different-32-char-secret-here

# Stripe
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx

# PayPal
PAYPAL_CLIENT_ID=your-paypal-client-id
PAYPAL_CLIENT_SECRET=your-paypal-secret
PAYPAL_BASE_URL=https://api-m.paypal.com

# Email (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxxx
EMAIL_FROM=bookings@goboki.com

# AWS S3
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=your-aws-secret
AWS_REGION=eu-west-1
AWS_S3_BUCKET=goboki-media

# Google OAuth
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-secret
GOOGLE_CALLBACK_URL=https://api.goboki.com/v1/auth/google/callback
```

### Frontend `.env.local`
```bash
NEXT_PUBLIC_API_URL=https://api.goboki.com/v1
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx
NEXT_PUBLIC_PAYPAL_CLIENT_ID=your-paypal-client-id
NEXT_PUBLIC_APP_URL=https://app.goboki.com
```

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CloudFront CDN                       │
│          (Static assets + API caching)                  │
└────────────────┬───────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
┌──────────────┐  ┌──────────────────┐
│   Vercel     │  │   AWS ECS        │
│  (Frontend)  │  │  (NestJS API)    │
│  Next.js 14  │  │  t3.medium × 2   │
└──────────────┘  └────────┬─────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
       ┌─────────┐  ┌──────────┐  ┌────────┐
       │ RDS PG  │  │ElastiCache│  │  S3    │
       │Multi-AZ │  │  Redis   │  │ Media  │
       └─────────┘  └──────────┘  └────────┘
```

---

## Deploy: Frontend (Vercel)

```bash
# Install Vercel CLI
npm i -g vercel

cd goboki/frontend
vercel --prod

# Or connect GitHub repo in Vercel dashboard
# Set environment variables in Vercel project settings
```

## Deploy: Backend (AWS ECS)

```bash
# 1. Build Docker image
docker build -t goboki-api ./backend

# 2. Push to ECR
aws ecr get-login-password --region eu-west-1 | \
  docker login --username AWS --password-stdin \
  <account-id>.dkr.ecr.eu-west-1.amazonaws.com

docker tag goboki-api:latest \
  <account-id>.dkr.ecr.eu-west-1.amazonaws.com/goboki-api:latest

docker push \
  <account-id>.dkr.ecr.eu-west-1.amazonaws.com/goboki-api:latest

# 3. Update ECS service
aws ecs update-service \
  --cluster goboki-cluster \
  --service goboki-api \
  --force-new-deployment
```

### Backend `Dockerfile`
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/main"]
```

---

## Database: AWS RDS PostgreSQL

```bash
# Create RDS instance (via AWS Console or Terraform)
# Engine: PostgreSQL 16
# Instance: db.t3.medium (prod) / db.t3.micro (staging)
# Multi-AZ: enabled (prod)
# Storage: 100 GB gp3, autoscaling enabled
# VPC: private subnet, no public access

# Run migrations
DATABASE_URL="postgresql://goboki_user:password@host:5432/goboki" \
  npm run migration:run

# Run seeds
DATABASE_URL="postgresql://..." npm run seed
```

---

## Stripe Webhook Setup

```bash
# Install Stripe CLI
stripe listen --forward-to localhost:3001/api/v1/payments/stripe/webhook

# Production: register in Stripe Dashboard
# URL: https://api.goboki.com/v1/payments/stripe/webhook
# Events to listen:
#   - payment_intent.succeeded
#   - payment_intent.payment_failed
#   - charge.refunded
#   - customer.subscription.created (for SaaS billing)
#   - customer.subscription.deleted
```

---

## CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/deploy.yml
name: Deploy GOBOKI

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_DB: goboki_test, POSTGRES_USER: test, POSTGRES_PASSWORD: test }
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: cd backend && npm ci && npm test

  deploy-frontend:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
          working-directory: frontend

  deploy-backend:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: eu-west-1
      - name: Build and push to ECR
        run: |
          aws ecr get-login-password | docker login --username AWS \
            --password-stdin ${{ secrets.ECR_REGISTRY }}
          docker build -t goboki-api ./backend
          docker tag goboki-api:latest ${{ secrets.ECR_REGISTRY }}/goboki-api:latest
          docker push ${{ secrets.ECR_REGISTRY }}/goboki-api:latest
      - name: Deploy to ECS
        run: |
          aws ecs update-service --cluster goboki --service goboki-api \
            --force-new-deployment
```

---

## Monitoring

- **Uptime:** AWS CloudWatch + UptimeRobot
- **Errors:** Sentry (both frontend and backend)
- **Logs:** AWS CloudWatch Logs
- **Performance:** New Relic or Datadog
- **DB:** RDS Performance Insights

## Estimated Monthly Costs (Production)

| Service | Spec | Est. Cost |
|---------|------|-----------|
| Vercel (frontend) | Pro plan | $20 |
| AWS ECS (2× t3.medium) | Backend API | $60 |
| AWS RDS (db.t3.medium Multi-AZ) | PostgreSQL | $100 |
| AWS ElastiCache (cache.t3.micro) | Redis | $20 |
| AWS S3 + CloudFront | Media & CDN | $15 |
| Stripe | 2.9% + $0.30/transaction | Variable |
| Resend | Email | $20 |
| **Total (fixed)** | | **~$235/mo** |
