// ============================================================
// ANALYTICS MODULE — Revenue, Occupancy, Customer Insights
// ============================================================
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class AnalyticsService {
  constructor(
    // @InjectRepository(Booking) private bookingRepo: Repository<Booking>,
    // @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
    // @InjectRepository(Customer) private customerRepo: Repository<Customer>,
  ) {}

  async getDashboardOverview(tenantId: string) {
    // In production, these are real DB queries.
    // Shown here as documented query patterns.
    return {
      revenue: await this.getRevenueStats(tenantId),
      bookings: await this.getBookingStats(tenantId),
      occupancy: await this.getOccupancyRate(tenantId),
      customers: await this.getCustomerStats(tenantId),
    };
  }

  async getRevenueStats(tenantId: string) {
    /* Real query:
    SELECT
      SUM(p.amount) AS total,
      SUM(CASE WHEN date_trunc('month', p.processed_at) = date_trunc('month', NOW()) THEN p.amount ELSE 0 END) AS this_month,
      SUM(CASE WHEN date_trunc('month', p.processed_at) = date_trunc('month', NOW() - INTERVAL '1 month') THEN p.amount ELSE 0 END) AS last_month
    FROM payments p
    WHERE p.tenant_id = $1 AND p.status = 'succeeded'
    */
    return {
      total: 234560.00,
      thisMonth: 42180.00,
      lastMonth: 35740.00,
      growth: 18.0,
      currency: 'USD',
    };
  }

  async getBookingStats(tenantId: string) {
    /* Real query:
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) AS confirmed,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
      COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled,
      AVG(total_amount) AS avg_value
    FROM bookings WHERE tenant_id = $1
    AND created_at >= NOW() - INTERVAL '30 days'
    */
    return {
      total: 127,
      confirmed: 98,
      pending: 21,
      cancelled: 8,
      avgValue: 3820.00,
      growth: 5,
    };
  }

  async getOccupancyRate(tenantId: string) {
    /* Real query:
    SELECT
      e.id,
      e.name,
      e.max_capacity,
      COUNT(b.id) AS booked_slots,
      ROUND(COUNT(b.id)::NUMERIC / (e.max_capacity * COUNT(DISTINCT b.start_date)) * 100, 1) AS rate
    FROM experiences e
    LEFT JOIN bookings b ON b.experience_id = e.id
      AND b.start_date >= CURRENT_DATE
      AND b.start_date <= CURRENT_DATE + INTERVAL '30 days'
      AND b.status NOT IN ('cancelled', 'refunded')
    WHERE e.tenant_id = $1
    GROUP BY e.id, e.name, e.max_capacity
    */
    return {
      overall: 84.0,
      target: 75.0,
      byExperience: [
        { name: 'Surf Retreat', rate: 92, capacity: 12, booked: 11 },
        { name: 'Dive Package', rate: 75, capacity: 8, booked: 6 },
        { name: 'Yoga Camp', rate: 88, capacity: 16, booked: 14 },
        { name: 'Safari 10D', rate: 80, capacity: 10, booked: 8 },
      ],
    };
  }

  async getCustomerStats(tenantId: string) {
    /* Real query:
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) AS new_this_month,
      COUNT(CASE WHEN total_bookings > 1 THEN 1 END) AS returning,
      ROUND(COUNT(CASE WHEN total_bookings > 1 THEN 1 END)::NUMERIC / COUNT(*) * 100, 1) AS retention_rate,
      AVG(total_spent) AS avg_ltv
    FROM customers WHERE tenant_id = $1
    */
    return {
      total: 312,
      newThisMonth: 38,
      returning: 187,
      retentionRate: 60.0,
      avgLifetimeValue: 4280.00,
      growth: 24,
    };
  }

  async getRevenueByMonth(tenantId: string, year: number) {
    /* Real query:
    SELECT
      EXTRACT(MONTH FROM p.processed_at) AS month,
      SUM(p.amount) AS revenue,
      COUNT(DISTINCT b.id) AS bookings
    FROM payments p
    JOIN bookings b ON b.id = p.booking_id
    WHERE p.tenant_id = $1
      AND EXTRACT(YEAR FROM p.processed_at) = $2
      AND p.status = 'succeeded'
    GROUP BY month ORDER BY month
    */
    return [
      { month: 1, revenue: 18200, bookings: 48 },
      { month: 2, revenue: 24100, bookings: 62 },
      { month: 3, revenue: 21400, bookings: 55 },
      { month: 4, revenue: 31800, bookings: 82 },
      { month: 5, revenue: 38500, bookings: 98 },
      { month: 6, revenue: 44200, bookings: 114 },
      { month: 7, revenue: 42180, bookings: 108 },
    ];
  }

  async getTopExperiences(tenantId: string, limit = 5) {
    /* Real query:
    SELECT
      e.name,
      COUNT(b.id) AS booking_count,
      SUM(b.total_amount) AS total_revenue,
      AVG(b.total_amount) AS avg_value,
      AVG(b.guests) AS avg_group_size
    FROM experiences e
    JOIN bookings b ON b.experience_id = e.id
      AND b.status NOT IN ('cancelled','refunded')
    WHERE e.tenant_id = $1
    GROUP BY e.id, e.name
    ORDER BY total_revenue DESC
    LIMIT $2
    */
    return [
      { name: 'Safari 10D', bookings: 24, revenue: 38400, avgValue: 1600 },
      { name: 'Surf Retreat', bookings: 48, revenue: 68160, avgValue: 1420 },
      { name: 'Yoga Camp', bookings: 32, revenue: 46400, avgValue: 1450 },
      { name: 'Dive Package', bookings: 18, revenue: 23400, avgValue: 1300 },
    ];
  }

  async getSourceBreakdown(tenantId: string) {
    /* SELECT source, COUNT(*), SUM(total_amount)
       FROM bookings WHERE tenant_id=$1 GROUP BY source */
    return [
      { source: 'widget', count: 68, revenue: 142800, pct: 53.5 },
      { source: 'direct', count: 31, revenue: 84200, pct: 24.4 },
      { source: 'referral', count: 18, revenue: 52400, pct: 14.2 },
      { source: 'api', count: 10, revenue: 28100, pct: 7.9 },
    ];
  }
}

// ── analytics.controller.ts ───────────────────────────────────
import { Controller, Get, Query, Param, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Dashboard overview stats' })
  getOverview(@Request() req: any) {
    return this.analyticsService.getDashboardOverview(
      req.user?.tenantId ?? 'a1b2c3d4-0000-0000-0000-000000000001'
    );
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Monthly revenue breakdown' })
  getRevenue(@Request() req: any, @Query('year') year = new Date().getFullYear()) {
    return this.analyticsService.getRevenueByMonth(
      req.user?.tenantId ?? 'a1b2c3d4-0000-0000-0000-000000000001',
      Number(year)
    );
  }

  @Get('top-experiences')
  @ApiOperation({ summary: 'Top experiences by revenue' })
  getTopExperiences(@Request() req: any, @Query('limit') limit = 5) {
    return this.analyticsService.getTopExperiences(
      req.user?.tenantId ?? 'a1b2c3d4-0000-0000-0000-000000000001',
      Number(limit)
    );
  }

  @Get('occupancy')
  @ApiOperation({ summary: 'Occupancy rates per experience' })
  getOccupancy(@Request() req: any) {
    return this.analyticsService.getOccupancyRate(
      req.user?.tenantId ?? 'a1b2c3d4-0000-0000-0000-000000000001'
    );
  }

  @Get('sources')
  @ApiOperation({ summary: 'Booking source breakdown' })
  getSources(@Request() req: any) {
    return this.analyticsService.getSourceBreakdown(
      req.user?.tenantId ?? 'a1b2c3d4-0000-0000-0000-000000000001'
    );
  }
}
