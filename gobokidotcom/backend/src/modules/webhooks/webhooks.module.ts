// ============================================================
// WEBHOOKS MODULE + TENANT GUARD + COMMON UTILITIES
// ============================================================

// ── webhooks/webhooks.service.ts ──────────────────────────────
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export type WebhookEvent =
  | 'booking.created' | 'booking.confirmed' | 'booking.cancelled' | 'booking.completed'
  | 'payment.received' | 'payment.refunded' | 'payment.failed'
  | 'customer.created';

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  tenantId: string;
  data: Record<string, any>;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly config: ConfigService) {}

  async fireEvent(tenantId: string, event: WebhookEvent, data: Record<string, any>) {
    // 1. Get all active webhooks for this tenant that subscribe to this event
    // const webhooks = await this.webhookRepo.find({
    //   where: { tenantId, isActive: true },
    // });
    // const matching = webhooks.filter(w => w.events.includes(event));

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      tenantId,
      data,
    };

    // 2. Fire each (in parallel, with retry on failure)
    // await Promise.allSettled(matching.map(w => this.deliver(w, payload)));
    this.logger.log(`Webhook fired: ${event} for tenant ${tenantId}`);
  }

  private async deliver(webhook: { url: string; secret: string }, payload: WebhookPayload) {
    const body = JSON.stringify(payload);
    const signature = this.sign(body, webhook.secret);

    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goboki-Signature': signature,
          'X-Goboki-Event': payload.event,
          'X-Goboki-Timestamp': payload.timestamp,
        },
        body,
        signal: AbortSignal.timeout(10_000), // 10s timeout
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      this.logger.log(`Webhook delivered to ${webhook.url} → ${res.status}`);
    } catch (err) {
      this.logger.error(`Webhook delivery failed to ${webhook.url}: ${err.message}`);
      throw err;
    }
  }

  private sign(body: string, secret: string): string {
    return 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
  }

  verifySignature(body: string, signature: string, secret: string): boolean {
    const expected = this.sign(body, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  }
}


// ── common/guards/tenant.guard.ts ─────────────────────────────
import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, UnauthorizedException
} from '@nestjs/common';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) throw new UnauthorizedException('Authentication required');
    if (!user.tenantId) throw new ForbiddenException('No tenant associated with this user');

    // Ensure all data access is scoped to user's tenant
    request.tenantId = user.tenantId;
    return true;
  }
}


// ── common/interceptors/audit.interceptor.ts ─────────────────
import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLog');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url, user } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
          this.logger.log(
            `[AUDIT] ${user?.email ?? 'anon'} | ${method} ${url} | ${duration}ms`
          );
          // TODO: persist to audit_logs table
        }
      }),
    );
  }
}


// ── common/filters/all-exceptions.filter.ts ──────────────────
import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = exception instanceof HttpException
      ? exception.getResponse()
      : 'Internal server error';

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url}`, exception);
    }

    response.status(status).json({
      statusCode: status,
      message: typeof message === 'object' && 'message' in (message as object)
        ? (message as any).message
        : message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}


// ── common/decorators/current-user.decorator.ts ──────────────
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);

export const TenantId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest().user?.tenantId;
  },
);


// ── Public Booking API (embeddable widget backend) ────────────
import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('public')
@Controller('public/:tenantSlug')
export class PublicBookingController {
  constructor(
    private readonly experiencesService: ExperiencesService,
    // private readonly tenantsService: TenantsService,
  ) {}

  @Get('experiences')
  @ApiOperation({ summary: 'Public: list experiences for a tenant' })
  async getExperiences(@Param('tenantSlug') slug: string) {
    // 1. Resolve tenantId from slug
    // 2. Return active experiences with pricing
    return this.experiencesService.findAll('resolved-tenant-id', true);
  }

  @Get('experiences/:experienceSlug')
  @ApiOperation({ summary: 'Public: single experience detail' })
  getExperience(
    @Param('tenantSlug') tenantSlug: string,
    @Param('experienceSlug') experienceSlug: string,
  ) {
    // return this.experiencesService.findBySlug(tenantId, experienceSlug);
  }

  @Get('availability')
  @ApiOperation({ summary: 'Public: check availability' })
  checkAvailability(
    @Param('tenantSlug') tenantSlug: string,
    @Query() dto: CheckAvailabilityDto,
  ) {
    return this.experiencesService.checkAvailability({ ...dto, tenantId: 'resolved' });
  }

  @Post('bookings')
  @ApiOperation({ summary: 'Public: create booking + payment intent' })
  createBooking(
    @Param('tenantSlug') tenantSlug: string,
    @Body() body: any,
  ) {
    // 1. Find/create customer
    // 2. Create booking
    // 3. Create Stripe PaymentIntent
    // 4. Return { booking, clientSecret }
  }
}
