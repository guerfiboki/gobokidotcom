// ============================================================
// BOOKINGS MODULE — Entity, DTOs, Service, Controller
// ============================================================

// ── booking.entity.ts ────────────────────────────────────────
import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany,
  CreateDateColumn, UpdateDateColumn, JoinColumn, Index
} from 'typeorm';

@Entity('bookings')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'startDate', 'endDate'])
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ unique: true })
  reference: string; // BK-2025-1024

  @Column({ name: 'customer_id' })
  customerId: string;

  @Column({ name: 'experience_id' })
  experienceId: string;

  @Column({ default: 'pending' })
  status: BookingStatus;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({ default: 1 })
  guests: number;

  @Column({ default: 1 })
  adults: number;

  @Column({ default: 0 })
  children: number;

  @Column({ name: 'base_amount', type: 'decimal', precision: 10, scale: 2 })
  baseAmount: number;

  @Column({ name: 'discount_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  discountAmount: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  taxAmount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 10, scale: 2 })
  totalAmount: number;

  @Column({ default: 'USD', length: 3 })
  currency: string;

  @Column({ name: 'paid_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  paidAmount: number;

  @Column({ name: 'deposit_percent', default: 30 })
  depositPercent: number;

  @Column({ name: 'deposit_due_date', type: 'date', nullable: true })
  depositDueDate: string;

  @Column({ name: 'balance_due_date', type: 'date', nullable: true })
  balanceDueDate: string;

  @Column({ name: 'special_requests', nullable: true })
  specialRequests: string;

  @Column({ name: 'internal_notes', nullable: true })
  internalNotes: string;

  @Column({ default: 'direct' })
  source: string;

  @Column({ name: 'cancelled_at', nullable: true })
  cancelledAt: Date;

  @Column({ name: 'cancel_reason', nullable: true })
  cancelReason: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

export type BookingStatus =
  | 'pending' | 'confirmed' | 'deposit_paid'
  | 'fully_paid' | 'cancelled' | 'refunded' | 'completed' | 'no_show';


// ── create-booking.dto.ts ────────────────────────────────────
import {
  IsUUID, IsDateString, IsInt, IsOptional, IsString,
  Min, Max, IsEnum
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBookingDto {
  @ApiProperty() @IsUUID()
  customerId: string;

  @ApiProperty() @IsUUID()
  experienceId: string;

  @ApiProperty({ example: '2025-09-01' }) @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2025-09-08' }) @IsDateString()
  endDate: string;

  @ApiProperty({ minimum: 1, maximum: 50 }) @IsInt() @Min(1) @Max(50)
  adults: number;

  @ApiPropertyOptional({ minimum: 0 }) @IsInt() @Min(0) @IsOptional()
  children?: number;

  @ApiPropertyOptional() @IsString() @IsOptional()
  specialRequests?: string;

  @ApiPropertyOptional({ enum: ['direct','widget','api','phone'] })
  @IsOptional()
  source?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsInt() @Min(0) @Max(100) @IsOptional()
  depositPercent?: number;
}

export class UpdateBookingDto {
  @ApiPropertyOptional({ enum: [
    'pending','confirmed','deposit_paid','fully_paid',
    'cancelled','refunded','completed','no_show'
  ]})
  @IsOptional() @IsEnum([
    'pending','confirmed','deposit_paid','fully_paid',
    'cancelled','refunded','completed','no_show'
  ])
  status?: BookingStatus;

  @ApiPropertyOptional() @IsString() @IsOptional()
  internalNotes?: string;

  @ApiPropertyOptional() @IsString() @IsOptional()
  cancelReason?: string;
}

export class BookingFiltersDto {
  @IsOptional() status?: BookingStatus;
  @IsOptional() experienceId?: string;
  @IsOptional() customerId?: string;
  @IsOptional() dateFrom?: string;
  @IsOptional() dateTo?: string;
  @IsOptional() search?: string;
  @IsOptional() @IsInt() @Min(1) page?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number;
}


// ── bookings.service.ts ───────────────────────────────────────
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, ILike } from 'typeorm';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
  ) {}

  async create(tenantId: string, dto: CreateBookingDto, userId?: string): Promise<Booking> {
    // Check availability
    const existing = await this.bookingRepo.count({
      where: {
        tenantId,
        experienceId: dto.experienceId,
        startDate: dto.startDate,
        status: 'confirmed',
      },
    });
    // (Real impl: check against max_capacity via availability table)

    const reference = await this.generateReference(tenantId);
    const adults = dto.adults;
    const children = dto.children ?? 0;
    const guests = adults + children;

    // (Real impl: fetch experience price, apply pricing rules)
    const baseAmount = 1420 * guests; // placeholder
    const totalAmount = baseAmount;

    const booking = this.bookingRepo.create({
      tenantId,
      reference,
      customerId: dto.customerId,
      experienceId: dto.experienceId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      guests,
      adults,
      children,
      baseAmount,
      totalAmount,
      currency: 'USD',
      depositPercent: dto.depositPercent ?? 30,
      source: dto.source ?? 'direct',
      status: 'pending',
    });

    return this.bookingRepo.save(booking);
  }

  async findAll(tenantId: string, filters: BookingFiltersDto) {
    const {
      status, experienceId, customerId,
      dateFrom, dateTo, search,
      page = 1, limit = 25,
    } = filters;

    const qb = this.bookingRepo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.customer', 'c')
      .leftJoinAndSelect('b.experience', 'e')
      .where('b.tenantId = :tenantId', { tenantId });

    if (status) qb.andWhere('b.status = :status', { status });
    if (experienceId) qb.andWhere('b.experienceId = :experienceId', { experienceId });
    if (customerId) qb.andWhere('b.customerId = :customerId', { customerId });
    if (dateFrom) qb.andWhere('b.startDate >= :dateFrom', { dateFrom });
    if (dateTo) qb.andWhere('b.startDate <= :dateTo', { dateTo });
    if (search) {
      qb.andWhere(
        '(b.reference ILIKE :search OR c.firstName ILIKE :search OR c.lastName ILIKE :search OR c.email ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    const [data, total] = await qb
      .orderBy('b.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(tenantId: string, id: string): Promise<Booking> {
    const booking = await this.bookingRepo.findOne({
      where: { id, tenantId },
      relations: ['customer', 'experience', 'payments', 'guests'],
    });
    if (!booking) throw new NotFoundException(`Booking ${id} not found`);
    return booking;
  }

  async update(tenantId: string, id: string, dto: UpdateBookingDto): Promise<Booking> {
    const booking = await this.findOne(tenantId, id);
    Object.assign(booking, dto);
    if (dto.status === 'cancelled') {
      booking.cancelledAt = new Date();
    }
    return this.bookingRepo.save(booking);
  }

  async cancel(tenantId: string, id: string, reason?: string): Promise<Booking> {
    return this.update(tenantId, id, { status: 'cancelled', cancelReason: reason });
  }

  async getCalendarData(tenantId: string, year: number, month: number) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    const bookings = await this.bookingRepo
      .createQueryBuilder('b')
      .leftJoin('b.experience', 'e')
      .select(['b.id', 'b.startDate', 'b.endDate', 'b.status', 'b.guests', 'e.name'])
      .where('b.tenantId = :tenantId', { tenantId })
      .andWhere('b.startDate <= :endDate AND b.endDate >= :startDate', { startDate, endDate })
      .andWhere("b.status NOT IN ('cancelled', 'refunded')")
      .getMany();

    return bookings;
  }

  private async generateReference(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.bookingRepo.count({ where: { tenantId } });
    return `BK-${year}-${String(count + 1).padStart(4, '0')}`;
  }
}


// ── bookings.controller.ts ────────────────────────────────────
import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param,
  Query, UseGuards, HttpCode, HttpStatus, Request
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('bookings')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard, TenantGuard)  // Apply in real impl
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new booking' })
  @ApiResponse({ status: 201, description: 'Booking created' })
  create(@Request() req: any, @Body() dto: CreateBookingDto) {
    const tenantId = req.user?.tenantId ?? 'a1b2c3d4-0000-0000-0000-000000000001';
    return this.bookingsService.create(tenantId, dto, req.user?.id);
  }

  @Get()
  @ApiOperation({ summary: 'List bookings with filters & pagination' })
  findAll(@Request() req: any, @Query() filters: BookingFiltersDto) {
    const tenantId = req.user?.tenantId ?? 'a1b2c3d4-0000-0000-0000-000000000001';
    return this.bookingsService.findAll(tenantId, filters);
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Get bookings for calendar view' })
  getCalendar(
    @Request() req: any,
    @Query('year') year: number,
    @Query('month') month: number,
  ) {
    const tenantId = req.user?.tenantId ?? 'a1b2c3d4-0000-0000-0000-000000000001';
    return this.bookingsService.getCalendarData(tenantId, year, month);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single booking' })
  findOne(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId ?? 'a1b2c3d4-0000-0000-0000-000000000001';
    return this.bookingsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update booking status or notes' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateBookingDto) {
    const tenantId = req.user?.tenantId ?? 'a1b2c3d4-0000-0000-0000-000000000001';
    return this.bookingsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a booking' })
  cancel(
    @Request() req: any,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    const tenantId = req.user?.tenantId ?? 'a1b2c3d4-0000-0000-0000-000000000001';
    return this.bookingsService.cancel(tenantId, id, reason);
  }
}
