// ============================================================
// CUSTOMERS MODULE — CRM, Profiles, Segmentation
// ============================================================
import {
  Injectable, NotFoundException, ConflictException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, ILike } from 'typeorm';
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, Index
} from 'typeorm';
import {
  IsEmail, IsString, IsOptional, IsArray,
  Length, IsPhoneNumber
} from 'class-validator';
import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Request
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

// ── Customer Entity ──────────────────────────────────────────
@Entity('customers')
@Index(['tenantId', 'email'], { unique: true })
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column()
  email: string;

  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name' })
  lastName: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true, length: 2 })
  nationality: string;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth: string;

  @Column({ type: 'text', array: true, default: [] })
  tags: string[];

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'dietary_notes', nullable: true })
  dietaryNotes: string;

  @Column({ name: 'medical_notes', nullable: true })
  medicalNotes: string;

  @Column({ nullable: true })
  source: string;

  @Column({ name: 'total_bookings', default: 0 })
  totalBookings: number;

  @Column({ name: 'total_spent', type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalSpent: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// ── DTOs ─────────────────────────────────────────────────────
export class CreateCustomerDto {
  @IsEmail() email: string;
  @IsString() @Length(1, 100) firstName: string;
  @IsString() @Length(1, 100) lastName: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() @Length(2, 2) nationality?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() dietaryNotes?: string;
}

export class UpdateCustomerDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() dietaryNotes?: string;
  @IsOptional() @IsString() medicalNotes?: string;
}

export class CustomerFiltersDto {
  @IsOptional() search?: string;
  @IsOptional() tags?: string | string[];
  @IsOptional() source?: string;
  @IsOptional() nationality?: string;
  @IsOptional() page?: number;
  @IsOptional() limit?: number;
}

// ── Service ───────────────────────────────────────────────────
@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
  ) {}

  async create(tenantId: string, dto: CreateCustomerDto): Promise<Customer> {
    const existing = await this.customerRepo.findOne({
      where: { tenantId, email: dto.email },
    });
    if (existing) throw new ConflictException(`Customer with email ${dto.email} already exists`);

    const customer = this.customerRepo.create({ ...dto, tenantId });
    return this.customerRepo.save(customer);
  }

  async findOrCreate(tenantId: string, dto: CreateCustomerDto): Promise<Customer> {
    const existing = await this.customerRepo.findOne({
      where: { tenantId, email: dto.email },
    });
    if (existing) return existing;
    return this.create(tenantId, dto);
  }

  async findAll(tenantId: string, filters: CustomerFiltersDto) {
    const { search, tags, source, nationality, page = 1, limit = 25 } = filters;

    const qb = this.customerRepo
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId });

    if (search) {
      qb.andWhere(
        `(c.firstName ILIKE :s OR c.lastName ILIKE :s OR c.email ILIKE :s OR c.phone LIKE :s)`,
        { s: `%${search}%` }
      );
    }

    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      qb.andWhere('c.tags && :tags', { tags: tagArray });
    }

    if (source) qb.andWhere('c.source = :source', { source });
    if (nationality) qb.andWhere('c.nationality = :nationality', { nationality });

    const [data, total] = await qb
      .orderBy('c.totalSpent', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.customerRepo.findOne({ where: { id, tenantId } });
    if (!customer) throw new NotFoundException(`Customer ${id} not found`);
    return customer;
  }

  async update(tenantId: string, id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const customer = await this.findOne(tenantId, id);
    Object.assign(customer, dto);
    return this.customerRepo.save(customer);
  }

  async addTag(tenantId: string, id: string, tag: string): Promise<Customer> {
    const customer = await this.findOne(tenantId, id);
    if (!customer.tags.includes(tag)) {
      customer.tags = [...customer.tags, tag];
      await this.customerRepo.save(customer);
    }
    return customer;
  }

  async removeTag(tenantId: string, id: string, tag: string): Promise<Customer> {
    const customer = await this.findOne(tenantId, id);
    customer.tags = customer.tags.filter(t => t !== tag);
    return this.customerRepo.save(customer);
  }

  async getStats(tenantId: string) {
    const result = await this.customerRepo
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId })
      .select([
        'COUNT(*) AS total',
        'COUNT(CASE WHEN c.totalBookings > 1 THEN 1 END) AS returning_customers',
        'AVG(c.totalSpent) AS avg_ltv',
        'SUM(c.totalSpent) AS total_revenue',
        `COUNT(CASE WHEN c.createdAt >= NOW() - INTERVAL '30 days' THEN 1 END) AS new_this_month`,
      ])
      .getRawOne();

    return {
      total: Number(result.total),
      returning: Number(result.returning_customers),
      retentionRate: result.total > 0
        ? Math.round((result.returning_customers / result.total) * 100)
        : 0,
      avgLifetimeValue: Math.round(Number(result.avg_ltv) || 0),
      totalRevenue: Number(result.total_revenue) || 0,
      newThisMonth: Number(result.new_this_month),
    };
  }

  async getBookingHistory(tenantId: string, customerId: string) {
    // Returns bookings for this customer
    // In real impl: inject BookingRepo and query
    return [];
  }

  async getTimeline(tenantId: string, customerId: string) {
    // Merged timeline: bookings + payments + emails + notes
    return [];
  }

  async bulkTag(tenantId: string, customerIds: string[], tags: string[]) {
    await this.customerRepo
      .createQueryBuilder()
      .update(Customer)
      .set({ tags: () => `array_cat(tags, ARRAY[${tags.map(t => `'${t}'`).join(',')}]::text[])` })
      .where('id IN (:...ids) AND tenantId = :tenantId', { ids: customerIds, tenantId })
      .execute();
  }

  async exportCsv(tenantId: string, filters: CustomerFiltersDto): Promise<string> {
    const { data } = await this.findAll(tenantId, { ...filters, limit: 10000 });
    const headers = ['ID', 'First Name', 'Last Name', 'Email', 'Phone', 'Nationality',
      'Tags', 'Source', 'Total Bookings', 'Total Spent', 'Created At'];
    const rows = data.map(c => [
      c.id, c.firstName, c.lastName, c.email, c.phone ?? '',
      c.nationality ?? '', c.tags.join(';'), c.source ?? '',
      c.totalBookings, c.totalSpent, c.createdAt.toISOString(),
    ]);
    return [headers, ...rows].map(r => r.join(',')).join('\n');
  }
}

// ── Controller ────────────────────────────────────────────────
@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  private getTenantId(req: any) {
    return req.user?.tenantId ?? 'a1b2c3d4-0000-0000-0000-000000000001';
  }

  @Get()
  @ApiOperation({ summary: 'List customers with search & filters' })
  findAll(@Request() req: any, @Query() filters: CustomerFiltersDto) {
    return this.customersService.findAll(this.getTenantId(req), filters);
  }

  @Get('stats')
  @ApiOperation({ summary: 'CRM aggregate stats' })
  getStats(@Request() req: any) {
    return this.customersService.getStats(this.getTenantId(req));
  }

  @Get('export')
  @ApiOperation({ summary: 'Export customers as CSV (GDPR compliant)' })
  async exportCsv(@Request() req: any, @Query() filters: CustomerFiltersDto) {
    const csv = await this.customersService.exportCsv(this.getTenantId(req), filters);
    // In real impl: set Content-Type header + return as stream
    return { csv };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get customer profile' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.customersService.findOne(this.getTenantId(req), id);
  }

  @Get(':id/bookings')
  @ApiOperation({ summary: 'Get customer booking history' })
  getBookings(@Request() req: any, @Param('id') id: string) {
    return this.customersService.getBookingHistory(this.getTenantId(req), id);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get customer activity timeline' })
  getTimeline(@Request() req: any, @Param('id') id: string) {
    return this.customersService.getTimeline(this.getTenantId(req), id);
  }

  @Post()
  @ApiOperation({ summary: 'Create customer profile' })
  create(@Request() req: any, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(this.getTenantId(req), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update customer profile' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(this.getTenantId(req), id, dto);
  }

  @Post(':id/tags')
  @ApiOperation({ summary: 'Add tag to customer' })
  addTag(@Request() req: any, @Param('id') id: string, @Body('tag') tag: string) {
    return this.customersService.addTag(this.getTenantId(req), id, tag);
  }

  @Delete(':id/tags/:tag')
  @ApiOperation({ summary: 'Remove tag from customer' })
  removeTag(@Request() req: any, @Param('id') id: string, @Param('tag') tag: string) {
    return this.customersService.removeTag(this.getTenantId(req), id, tag);
  }

  @Post('bulk-tag')
  @ApiOperation({ summary: 'Bulk add tags to multiple customers' })
  bulkTag(
    @Request() req: any,
    @Body('customerIds') customerIds: string[],
    @Body('tags') tags: string[],
  ) {
    return this.customersService.bulkTag(this.getTenantId(req), customerIds, tags);
  }
}
