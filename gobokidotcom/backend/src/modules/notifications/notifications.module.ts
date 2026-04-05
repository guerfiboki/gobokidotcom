// ============================================================
// NOTIFICATIONS MODULE — Email/SMS automation with Bull queue
// ============================================================
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Process, Processor, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as Handlebars from 'handlebars';

// ── Email Templates (Handlebars) ─────────────────────────────
const TEMPLATES = {
  booking_confirmed: {
    subject: 'Your booking is confirmed! 🎉 — {{experienceName}}',
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, sans-serif; color: #1a1a2e; margin: 0; padding: 0; }
    .container { max-width: 580px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #0f1923, #0d9f80); padding: 32px; text-align: center; }
    .logo { color: #fff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .logo span { color: #0d9f80; }
    .body { padding: 32px; background: #fff; }
    .hero { background: #f0faf7; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    .ref { font-size: 13px; color: #6b7280; margin-bottom: 4px; }
    .experience { font-size: 22px; font-weight: 700; color: #0f1923; }
    .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; }
    .detail { }
    .detail-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; }
    .detail-value { font-size: 15px; font-weight: 600; color: #0f1923; margin-top: 2px; }
    .amount-box { background: #0d9f80; color: #fff; border-radius: 10px; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; }
    .deposit-note { font-size: 12px; color: #6b7280; margin-top: 12px; }
    .cta { display: block; text-align: center; background: #0d9f80; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 600; font-size: 15px; margin: 24px 0; }
    .footer { background: #f9fafb; padding: 20px 32px; text-align: center; font-size: 12px; color: #9ca3af; }
    .divider { height: 1px; background: #e5e7eb; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">GO<span>BOKI</span></div>
      <p style="color:rgba(255,255,255,0.7);font-size:14px;margin-top:8px">Booking Confirmation</p>
    </div>
    <div class="body">
      <p style="font-size:16px;color:#374151;">Hi {{customerFirstName}},</p>
      <p style="color:#6b7280;font-size:14px;line-height:1.6;">
        Your booking has been confirmed. We're excited to have you join us!
      </p>
      <div class="hero">
        <div class="ref">Booking Reference</div>
        <div class="experience">{{bookingReference}}</div>
        <div style="font-size:16px;color:#374151;margin-top:6px;font-weight:500;">{{experienceName}}</div>
      </div>
      <div class="details-grid">
        <div class="detail">
          <div class="detail-label">Check-in</div>
          <div class="detail-value">{{startDate}}</div>
        </div>
        <div class="detail">
          <div class="detail-label">Check-out</div>
          <div class="detail-value">{{endDate}}</div>
        </div>
        <div class="detail">
          <div class="detail-label">Guests</div>
          <div class="detail-value">{{guests}} person(s)</div>
        </div>
        <div class="detail">
          <div class="detail-label">Location</div>
          <div class="detail-value">{{location}}</div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="amount-box">
        <div>
          <div style="font-size:12px;opacity:0.8;">Total Amount</div>
          <div style="font-size:24px;font-weight:700;">{{currency}} {{totalAmount}}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px;opacity:0.8;">Paid (Deposit)</div>
          <div style="font-size:18px;font-weight:600;">{{currency}} {{paidAmount}}</div>
        </div>
      </div>
      <p class="deposit-note">
        💳 Balance of <strong>{{currency}} {{balanceDue}}</strong> is due by <strong>{{balanceDueDate}}</strong>.
        You'll receive a reminder 7 days before.
      </p>
      <a href="{{manageUrl}}" class="cta">Manage Your Booking</a>
      <div class="divider"></div>
      <p style="font-size:13px;color:#9ca3af;line-height:1.6;">
        Questions? Reply to this email or contact us at
        <a href="mailto:{{supportEmail}}" style="color:#0d9f80;">{{supportEmail}}</a>
      </p>
    </div>
    <div class="footer">
      <p>{{tenantName}} · Powered by GOBOKI</p>
      <p style="margin-top:4px;">
        <a href="{{unsubscribeUrl}}" style="color:#d1d5db;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`,
  },

  deposit_reminder: {
    subject: '⏰ Deposit reminder — {{bookingReference}} balance due {{balanceDueDate}}',
    html: `
<div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
  <div style="background:#0f1923;padding:24px;text-align:center;">
    <div style="color:#fff;font-size:22px;font-weight:700;">GO<span style="color:#0d9f80">BOKI</span></div>
  </div>
  <div style="padding:28px;background:#fff;">
    <p>Hi {{customerFirstName}},</p>
    <p style="color:#6b7280;">Your balance payment for <strong>{{experienceName}}</strong> is due on <strong>{{balanceDueDate}}</strong>.</p>
    <div style="background:#fef9c3;border:1px solid #fde047;border-radius:10px;padding:16px;margin:20px 0;">
      <div style="font-size:13px;color:#854d0e;">Amount Due</div>
      <div style="font-size:26px;font-weight:700;color:#713f12;">{{currency}} {{balanceDue}}</div>
    </div>
    <a href="{{paymentUrl}}" style="display:block;text-align:center;background:#0d9f80;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:600;margin:20px 0;">
      Pay Balance Now
    </a>
    <p style="font-size:12px;color:#9ca3af;">Booking: {{bookingReference}} · {{startDate}} – {{endDate}}</p>
  </div>
</div>`,
  },

  pre_arrival: {
    subject: '🌊 You\'re arriving soon! Everything you need for {{experienceName}}',
    html: `
<div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#0f1923,#0d9f80);padding:32px;text-align:center;color:#fff;">
    <div style="font-size:22px;font-weight:700;">GO<span style="color:#7ee8d4">BOKI</span></div>
    <h1 style="font-size:20px;margin-top:12px;">Your adventure begins in {{daysUntilArrival}} days!</h1>
  </div>
  <div style="padding:28px;background:#fff;">
    <p>Hi {{customerFirstName}},</p>
    <p style="color:#6b7280;line-height:1.6;">We're counting down the days to welcome you to <strong>{{experienceName}}</strong>. Here's everything you need to know:</p>
    <div style="background:#f0faf7;border-radius:10px;padding:20px;margin:20px 0;">
      <h3 style="color:#0d9f80;font-size:15px;margin-bottom:12px;">📋 What to bring</h3>
      <ul style="color:#374151;font-size:14px;line-height:2;padding-left:18px;">
        <li>Valid passport / ID</li>
        <li>Comfortable clothing & swimwear</li>
        <li>Sunscreen (reef-safe recommended)</li>
        <li>Any prescription medications</li>
      </ul>
    </div>
    <div style="background:#eff6ff;border-radius:10px;padding:20px;margin:20px 0;">
      <h3 style="color:#1a6fd4;font-size:15px;margin-bottom:8px;">📍 Meeting point</h3>
      <p style="color:#374151;font-size:14px;margin:0;">{{meetingPoint}}</p>
      <p style="color:#6b7280;font-size:13px;margin:4px 0 0;">{{meetingTime}}</p>
    </div>
    <a href="{{guideUrl}}" style="display:block;text-align:center;background:#0f1923;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:600;margin:20px 0;">
      Download Full Arrival Guide
    </a>
  </div>
</div>`,
  },
};

// ── Job interfaces ────────────────────────────────────────────
export interface SendEmailJob {
  to: string;
  toName: string;
  templateKey: keyof typeof TEMPLATES;
  data: Record<string, any>;
  tenantId: string;
  bookingId?: string;
  customerId?: string;
}

// ── Notifications Service ─────────────────────────────────────
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private resend: Resend;

  constructor(
    @InjectQueue('notifications') private readonly notifQueue: Queue,
    private readonly config: ConfigService,
  ) {
    this.resend = new Resend(config.get('RESEND_API_KEY'));
  }

  // ── Queue helpers ─────────────────────────────────────────
  async sendBookingConfirmation(booking: any, customer: any) {
    return this.notifQueue.add('send-email', {
      to: customer.email,
      toName: `${customer.firstName} ${customer.lastName}`,
      templateKey: 'booking_confirmed',
      tenantId: booking.tenantId,
      bookingId: booking.id,
      customerId: customer.id,
      data: {
        customerFirstName: customer.firstName,
        bookingReference: booking.reference,
        experienceName: booking.experience?.name,
        startDate: booking.startDate,
        endDate: booking.endDate,
        guests: booking.guests,
        location: `${booking.experience?.location?.city}, ${booking.experience?.location?.country}`,
        currency: booking.currency,
        totalAmount: booking.totalAmount.toLocaleString(),
        paidAmount: booking.paidAmount.toLocaleString(),
        balanceDue: booking.balanceDue.toLocaleString(),
        balanceDueDate: booking.balanceDueDate,
        manageUrl: `${this.config.get('CLIENT_URL')}/bookings/${booking.id}`,
        tenantName: booking.tenant?.name,
        supportEmail: booking.tenant?.settings?.supportEmail ?? 'support@goboki.com',
      },
    } as SendEmailJob, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  async scheduleDepositReminder(booking: any, customer: any, sendAt: Date) {
    const delay = sendAt.getTime() - Date.now();
    if (delay < 0) return; // already past

    return this.notifQueue.add('send-email', {
      to: customer.email,
      toName: `${customer.firstName} ${customer.lastName}`,
      templateKey: 'deposit_reminder',
      tenantId: booking.tenantId,
      bookingId: booking.id,
      customerId: customer.id,
      data: {
        customerFirstName: customer.firstName,
        bookingReference: booking.reference,
        experienceName: booking.experience?.name,
        currency: booking.currency,
        balanceDue: booking.balanceDue.toLocaleString(),
        balanceDueDate: booking.balanceDueDate,
        paymentUrl: `${this.config.get('CLIENT_URL')}/pay/${booking.id}`,
        startDate: booking.startDate,
        endDate: booking.endDate,
      },
    } as SendEmailJob, {
      delay,
      attempts: 3,
      backoff: { type: 'fixed', delay: 10000 },
    });
  }

  async schedulePreArrivalEmail(booking: any, customer: any, daysBeforeArrival = 3) {
    const arrivalDate = new Date(booking.startDate);
    const sendDate = new Date(arrivalDate);
    sendDate.setDate(sendDate.getDate() - daysBeforeArrival);
    const delay = sendDate.getTime() - Date.now();
    if (delay < 0) return;

    return this.notifQueue.add('send-email', {
      to: customer.email,
      toName: `${customer.firstName} ${customer.lastName}`,
      templateKey: 'pre_arrival',
      tenantId: booking.tenantId,
      bookingId: booking.id,
      customerId: customer.id,
      data: {
        customerFirstName: customer.firstName,
        experienceName: booking.experience?.name,
        daysUntilArrival: daysBeforeArrival,
        meetingPoint: booking.experience?.location?.city ?? 'TBC',
        meetingTime: '09:00 AM local time',
        guideUrl: `${this.config.get('CLIENT_URL')}/guides/${booking.experienceId}`,
      },
    } as SendEmailJob, { delay, attempts: 2 });
  }

  // ── Direct send (no queue) ────────────────────────────────
  async sendDirect(params: { to: string; subject: string; html: string; tenantId: string }) {
    const fromEmail = this.config.get('EMAIL_FROM', 'bookings@goboki.com');
    return this.resend.emails.send({
      from: fromEmail,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
  }
}

// ── Queue Processor ──────────────────────────────────────────
@Processor('notifications')
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);
  private resend: Resend;

  constructor(private readonly config: ConfigService) {
    this.resend = new Resend(config.get('RESEND_API_KEY'));
  }

  @Process('send-email')
  async handleSendEmail(job: Job<SendEmailJob>) {
    const { to, toName, templateKey, data, tenantId } = job.data;
    const template = TEMPLATES[templateKey];
    if (!template) {
      this.logger.error(`Unknown template: ${templateKey}`);
      return;
    }

    try {
      // Compile template
      const subjectFn = Handlebars.compile(template.subject);
      const htmlFn = Handlebars.compile(template.html);
      const subject = subjectFn(data);
      const html = htmlFn(data);

      // Send via Resend
      const result = await this.resend.emails.send({
        from: `${data.tenantName ?? 'GOBOKI'} <${this.config.get('EMAIL_FROM', 'bookings@goboki.com')}>`,
        to: `${toName} <${to}>`,
        subject,
        html,
        tags: [
          { name: 'tenantId', value: tenantId },
          { name: 'template', value: templateKey },
        ],
      });

      this.logger.log(`Email sent: ${templateKey} → ${to} (${result.data?.id})`);

      // TODO: update email_logs record status → 'sent'
      return result;
    } catch (err) {
      this.logger.error(`Failed to send ${templateKey} to ${to}: ${err.message}`);
      throw err; // triggers Bull retry
    }
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} (${job.name}) failed after ${job.attemptsMade} attempts: ${error.message}`);
  }
}
