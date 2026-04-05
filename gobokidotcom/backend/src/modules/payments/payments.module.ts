// ============================================================
// PAYMENTS MODULE — Stripe + PayPal + Invoicing
// ============================================================
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

// ── payments.service.ts ──────────────────────────────────────
@Injectable()
export class PaymentsService {
  private stripe: Stripe;

  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(config.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2024-04-10',
    });
  }

  // ── Stripe: Create Payment Intent ──────────────────────────
  async createStripePaymentIntent(params: {
    bookingId: string;
    tenantId: string;
    amount: number;       // in smallest currency unit (cents)
    currency: string;
    customerId?: string;  // Stripe customer ID
    metadata?: Record<string, string>;
    isDeposit?: boolean;
  }): Promise<{ clientSecret: string; paymentIntentId: string }> {
    const intent = await this.stripe.paymentIntents.create({
      amount: Math.round(params.amount * 100), // Convert to cents
      currency: params.currency.toLowerCase(),
      customer: params.customerId,
      metadata: {
        bookingId: params.bookingId,
        tenantId: params.tenantId,
        type: params.isDeposit ? 'deposit' : 'full_payment',
        ...params.metadata,
      },
      automatic_payment_methods: { enabled: true },
      description: `GOBOKI Booking ${params.bookingId}`,
    });

    return {
      clientSecret: intent.client_secret!,
      paymentIntentId: intent.id,
    };
  }

  // ── Stripe: Handle Webhook ────────────────────────────────
  async handleStripeWebhook(payload: Buffer, signature: string): Promise<void> {
    const webhookSecret = this.config.get('STRIPE_WEBHOOK_SECRET');
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onPaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await this.onPaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      case 'charge.refunded':
        await this.onChargeRefunded(event.data.object as Stripe.Charge);
        break;
    }
  }

  private async onPaymentSucceeded(intent: Stripe.PaymentIntent) {
    const { bookingId, tenantId } = intent.metadata;
    // 1. Update payment record status → 'succeeded'
    // 2. Update booking.paidAmount += intent.amount / 100
    // 3. Determine if deposit or full payment → update booking.status
    // 4. Trigger: send confirmation email, generate invoice, fire webhooks
    console.log(`✅ Payment succeeded for booking ${bookingId}`);
  }

  private async onPaymentFailed(intent: Stripe.PaymentIntent) {
    const { bookingId } = intent.metadata;
    // 1. Update payment record status → 'failed'
    // 2. Send failure notification to customer
    console.log(`❌ Payment failed for booking ${bookingId}`);
  }

  private async onChargeRefunded(charge: Stripe.Charge) {
    // Handle refund: update booking + payment records
    console.log(`↩️ Charge refunded: ${charge.id}`);
  }

  // ── Stripe: Issue Refund ───────────────────────────────────
  async createRefund(params: {
    paymentIntentId: string;
    amount?: number; // partial refund; omit for full refund
    reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
  }): Promise<Stripe.Refund> {
    return this.stripe.refunds.create({
      payment_intent: params.paymentIntentId,
      amount: params.amount ? Math.round(params.amount * 100) : undefined,
      reason: params.reason ?? 'requested_by_customer',
    });
  }

  // ── Stripe: Create/Get Customer ───────────────────────────
  async getOrCreateStripeCustomer(params: {
    email: string;
    name: string;
    phone?: string;
    tenantId: string;
  }): Promise<string> {
    const existing = await this.stripe.customers.list({
      email: params.email,
      limit: 1,
    });

    if (existing.data.length > 0) return existing.data[0].id;

    const customer = await this.stripe.customers.create({
      email: params.email,
      name: params.name,
      phone: params.phone,
      metadata: { tenantId: params.tenantId },
    });

    return customer.id;
  }

  // ── PayPal: Create Order ───────────────────────────────────
  async createPayPalOrder(params: {
    bookingId: string;
    amount: number;
    currency: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ orderId: string; approvalUrl: string }> {
    const clientId = this.config.get('PAYPAL_CLIENT_ID');
    const clientSecret = this.config.get('PAYPAL_CLIENT_SECRET');
    const base = this.config.get('PAYPAL_BASE_URL', 'https://api-m.sandbox.paypal.com');

    // Get access token
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const { access_token } = await tokenRes.json() as any;

    // Create order
    const orderRes = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          custom_id: params.bookingId,
          amount: {
            currency_code: params.currency,
            value: params.amount.toFixed(2),
          },
        }],
        application_context: {
          return_url: params.returnUrl,
          cancel_url: params.cancelUrl,
        },
      }),
    });

    const order = await orderRes.json() as any;
    const approvalUrl = order.links.find((l: any) => l.rel === 'approve').href;

    return { orderId: order.id, approvalUrl };
  }

  // ── Invoice Number Generator ──────────────────────────────
  generateInvoiceNumber(tenantSlug: string, sequence: number): string {
    const year = new Date().getFullYear();
    return `INV-${year}-${String(sequence).padStart(4, '0')}`;
  }
}


// ── payments.controller.ts ────────────────────────────────────
import {
  Controller, Post, Body, Get, Param,
  Headers, RawBodyRequest, Req, HttpCode, HttpStatus
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsNumber, IsString, IsOptional, IsEnum, Min } from 'class-validator';

class CreatePaymentIntentDto {
  @IsString() bookingId: string;
  @IsNumber() @Min(0.01) amount: number;
  @IsString() currency: string;
  @IsOptional() isDeposit?: boolean;
}

class CreateRefundDto {
  @IsString() paymentIntentId: string;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsEnum(['duplicate','fraudulent','requested_by_customer']) reason?: string;
}

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('stripe/intent')
  @ApiOperation({ summary: 'Create Stripe PaymentIntent' })
  createIntent(@Req() req: any, @Body() dto: CreatePaymentIntentDto) {
    return this.paymentsService.createStripePaymentIntent({
      bookingId: dto.bookingId,
      tenantId: req.user?.tenantId ?? 'demo',
      amount: dto.amount,
      currency: dto.currency,
      isDeposit: dto.isDeposit,
    });
  }

  @Post('stripe/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook endpoint' })
  stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.paymentsService.handleStripeWebhook(req.rawBody as Buffer, signature);
  }

  @Post('paypal/order')
  @ApiOperation({ summary: 'Create PayPal order' })
  createPayPalOrder(@Req() req: any, @Body() body: any) {
    const clientUrl = 'http://localhost:3000';
    return this.paymentsService.createPayPalOrder({
      bookingId: body.bookingId,
      amount: body.amount,
      currency: body.currency ?? 'USD',
      returnUrl: `${clientUrl}/bookings/${body.bookingId}/payment/success`,
      cancelUrl: `${clientUrl}/bookings/${body.bookingId}/payment/cancel`,
    });
  }

  @Post('refund')
  @ApiOperation({ summary: 'Issue a refund' })
  refund(@Body() dto: CreateRefundDto) {
    return this.paymentsService.createRefund({
      paymentIntentId: dto.paymentIntentId,
      amount: dto.amount,
      reason: dto.reason as any,
    });
  }
}
