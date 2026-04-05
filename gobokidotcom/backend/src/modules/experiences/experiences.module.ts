// ============================================================
// EXPERIENCES MODULE — Products, Pricing Rules, Availability
// ============================================================
import {
  Injectable, NotFoundException, BadRequestException
} from '@nestjs/common';
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index
} from 'typeorm';
import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Request, HttpCode, HttpStatus
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsInt, IsBoolean, Min } from 'class-validator';
import { eachDayOfInterval, format, parseISO, differenceInDays } from 'date-fns';

// ── Experience Entity ─────────────────────────────────────────
@Entity('experiences')
export class Experience {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column()
  name: string;

  @Column()
  slug: string;

  @Column()
  type: string;

  @Column({ nullable: true, type: 'text' })
  description: string;

  @Column({ name: 'short_desc', nullable: true })
  shortDesc: string;

  @Column({ type: 'jsonb', default: [] })
  images: string[];

  @Column({ name: 'base_price', type: 'decimal', precision: 10, scale: 2 })
  basePrice: number;

  @Column({ default: 'USD', length: 3 })
  currency: string;

  @Column({ name: 'duration_days', nullable: true })
  durationDays: number;

  @Column({ name: 'max_capacity', default: 10 })
  maxCapacity: number;

  @Column({ name: 'min_guests', default: 1 })
  minGuests: number;

  @Column({ name: 'max_guests', default: 10 })
  maxGuests: number;

  @Column({ type: 'jsonb', nullable: true })
  location: {
    country: string;
    city: string;
    coordinates: { lat: number; lng: number };
  };

  @Column({ type: 'jsonb', default: [] })
  inclusions: string[];

  @Column({ type: 'jsonb', default: [] })
  exclusions: string[];

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'seo_title', nullable: true })
  seoTitle: string;

  @Column({ name: 'seo_description', nullable: true })
  seoDescription: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// ── DTOs ─────────────────────────────────────────────────────
export class CreateExperienceDto {
  @IsString() name: string;
  @IsString() slug: string;
  @IsString() type: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @Min(0) basePrice: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() durationDays?: number;
  @IsOptional() @IsInt() maxCapacity?: number;
  @IsOptional() @IsInt() maxGuests?: number;
  @IsOptional() location?: any;
  @IsOptional() inclusions?: string[];
  @IsOptional() exclusions?: string[];
}

export class CheckAvailabilityDto {
  @IsString() experienceId: string;
  @IsString() startDate: string;
  @IsString() endDate: string;
  @IsInt() @Min(1) guests: number;
}

// ── Experiences Service ───────────────────────────────────────
@Injectable()
export class ExperiencesService {
  // In real impl: inject ExperienceRepo, AvailabilityRepo, PricingRulesRepo

  async findAll(tenantId: string, activeOnly = true) {
    // Real: return ExperienceRepo.find({ where: { tenantId, isActive: activeOnly } })
    return [
      {
        id: 'exp-001',
        tenantId,
        name: '7-Day Surf Retreat',
        slug: '7-day-surf-retreat',
        type: 'retreat',
        basePrice: 1420,
        currency: 'USD',
        durationDays: 7,
        maxCapacity: 12,
        location: { country: 'MA', city: 'Taghazout' },
        inclusions: ['3 surf sessions/day', 'Accommodation', 'Breakfast & dinner', 'Airport transfer'],
        isActive: true,
      },
      {
        id: 'exp-002',
        tenantId,
        name: 'Dive Master Package',
        slug: 'dive-master-package',
        type: 'package',
        basePrice: 1300,
        currency: 'USD',
        durationDays: 8,
        maxCapacity: 8,
        location: { country: 'EG', city: 'Dahab' },
        inclusions: ['PADI certification fees', 'All dives', 'Equipment', 'Accommodation'],
        isActive: true,
      },
    ];
  }

  async findOne(tenantId: string, id: string): Promise<Experience> {
    // Real: const exp = await ExperienceRepo.findOne({ where: { id, tenantId } });
    // if (!exp) throw new NotFoundException();
    return {} as Experience;
  }

  async calculatePrice(params: {
    experienceId: string;
    tenantId: string;
    startDate: string;
    endDate: string;
    guests: number;
  }): Promise<{
    basePrice: number;
    pricePerPerson: number;
    total: number;
    depositAmount: number;
    currency: string;
    breakdown: Array<{ label: string; amount: number }>;
  }> {
    // 1. Fetch experience base price
    // 2. Check applicable pricing rules (seasonal, group, etc.)
    // 3. Apply modifiers in priority order
    // 4. Calculate deposit

    const basePricePerPerson = 1420;
    const pricePerPerson = basePricePerPerson; // after rules
    const total = pricePerPerson * params.guests;
    const depositAmount = Math.round(total * 0.30);

    return {
      basePrice: basePricePerPerson,
      pricePerPerson,
      total,
      depositAmount,
      currency: 'USD',
      breakdown: [
        { label: `${params.guests} × ${pricePerPerson.toLocaleString()}/person`, amount: total },
        { label: 'Taxes & fees', amount: 0 },
      ],
    };
  }

  async checkAvailability(params: CheckAvailabilityDto & { tenantId: string }) {
    const { experienceId, startDate, endDate, guests, tenantId } = params;

    // 1. Check blocked dates
    // 2. Count existing confirmed bookings in date range
    // 3. Compare against capacity

    // Placeholder:
    const maxCapacity = 12;
    const confirmedBookings = 4; // from DB
    const remaining = maxCapacity - confirmedBookings;

    if (remaining < guests) {
      return { available: false, remainingCapacity: remaining, message: 'Not enough capacity' };
    }

    const pricing = await this.calculatePrice({
      experienceId, tenantId, startDate, endDate, guests
    });

    return {
      available: true,
      remainingCapacity: remaining,
      price: pricing.total,
      depositAmount: pricing.depositAmount,
      currency: pricing.currency,
      breakdown: pricing.breakdown,
    };
  }

  async getCalendarAvailability(tenantId: string, experienceId: string, year: number, month: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    // In real impl: fetch availability table + booked count per day
    const blockedDates = new Set(['2025-08-14', '2025-08-16', '2025-08-21']);
    const bookedMap: Record<string, number> = {
      '2025-08-12': 4, '2025-08-13': 8, '2025-08-15': 6,
    };

    return days.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const booked = bookedMap[dateStr] ?? 0;
      const isBlocked = blockedDates.has(dateStr);
      const capacity = 12;
      const remaining = Math.max(0, capacity - booked);

      return {
        date: dateStr,
        available: !isBlocked && remaining > 0,
        capacity,
        booked,
        remaining,
        isBlocked,
        pctFull: Math.round((booked / capacity) * 100),
      };
    });
  }
}

// ── Experiences Controller ────────────────────────────────────
@ApiTags('experiences')
@ApiBearerAuth()
@Controller('experiences')
export class ExperiencesController {
  constructor(private readonly experiencesService: ExperiencesService) {}

  @Get()
  @ApiOperation({ summary: 'List all experiences' })
  findAll(@Request() req: any, @Query('activeOnly') activeOnly = true) {
    return this.experiencesService.findAll(
      req.user?.tenantId ?? 'demo', activeOnly
    );
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.experiencesService.findOne(req.user?.tenantId ?? 'demo', id);
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Calendar availability for an experience' })
  getAvailability(
    @Request() req: any,
    @Param('id') id: string,
    @Query('year') year: number,
    @Query('month') month: number,
  ) {
    return this.experiencesService.getCalendarAvailability(
      req.user?.tenantId ?? 'demo', id, year, month
    );
  }

  @Post()
  create(@Request() req: any, @Body() dto: CreateExperienceDto) {
    // return this.experiencesService.create(req.user.tenantId, dto);
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() dto: Partial<CreateExperienceDto>) {
    // return this.experiencesService.update(req.user.tenantId, id, dto);
  }
}

// ── Availability Controller (separate endpoint) ───────────────
@ApiTags('availability')
@ApiBearerAuth()
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly experiencesService: ExperiencesService) {}

  @Get('check')
  @ApiOperation({ summary: 'Check availability for a booking' })
  check(@Request() req: any, @Query() dto: CheckAvailabilityDto) {
    return this.experiencesService.checkAvailability({
      ...dto,
      tenantId: req.user?.tenantId ?? 'demo',
    });
  }
}
