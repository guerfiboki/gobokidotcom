// ============================================================
// AUTH MODULE — JWT + Google OAuth + RBAC Guards
// ============================================================

// ── auth.service.ts ──────────────────────────────────────────
import {
  Injectable, UnauthorizedException,
  ConflictException, BadRequestException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

export interface JwtPayload {
  sub: string;         // user id
  tenantId: string;
  email: string;
  role: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    // private readonly usersService: UsersService,
    // private readonly tenantsService: TenantsService,
  ) {}

  async login(email: string, password: string): Promise<TokenPair> {
    // 1. Find user by email (across all tenants — email unique per tenant)
    // const user = await this.usersService.findByEmail(email);
    // Placeholder:
    const user = {
      id: 'demo-user-id',
      tenantId: 'a1b2c3d4-0000-0000-0000-000000000001',
      email,
      passwordHash: await bcrypt.hash('Demo1234!', 12),
      role: 'owner',
      isActive: true,
    };

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateTokens({
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });
  }

  async register(dto: RegisterDto): Promise<TokenPair> {
    // 1. Create tenant
    // 2. Create owner user
    // 3. Send welcome email
    // 4. Return tokens
    throw new Error('Implement with UsersService + TenantsService');
  }

  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
      return this.generateTokens({
        sub: payload.sub,
        tenantId: payload.tenantId,
        email: payload.email,
        role: payload.role,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async handleGoogleCallback(profile: any, tenantSlug?: string): Promise<TokenPair> {
    // Find or create user from Google profile
    // Associate with tenant by slug if provided
    throw new Error('Implement Google OAuth flow');
  }

  private generateTokens(payload: JwtPayload): TokenPair {
    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: '15m',
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: '30d',
    });
    return { accessToken, refreshToken, expiresIn: 900 };
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }
}


// ── dto ──────────────────────────────────────────────────────
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'jordan@bluehorizon.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Demo1234!' })
  @IsString() @MinLength(8)
  password: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'Blue Horizon Retreats' })
  @IsString() @MinLength(2)
  businessName: string;

  @ApiProperty({ example: 'blue-horizon' })
  @IsString()
  slug: string;

  @ApiProperty() @IsEmail()
  email: string;

  @ApiProperty() @IsString() @MinLength(8)
  password: string;

  @ApiProperty() @IsString()
  firstName: string;

  @ApiProperty() @IsString()
  lastName: string;
}

export class RefreshTokenDto {
  @ApiProperty() @IsString()
  refreshToken: string;
}


// ── jwt.strategy.ts ──────────────────────────────────────────
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role,
    };
  }
}


// ── roles.guard.ts ────────────────────────────────────────────
import {
  Injectable, CanActivate, ExecutionContext, SetMetadata
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    // Super admin bypasses all
    if (user.role === 'super_admin') return true;

    return requiredRoles.includes(user.role);
  }
}


// ── auth.controller.ts ───────────────────────────────────────
import {
  Controller, Post, Body, Get, UseGuards,
  Request, HttpCode, HttpStatus
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email + password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('register')
  @ApiOperation({ summary: 'Register new business + owner account' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Get('google')
  @ApiOperation({ summary: 'Initiate Google OAuth' })
  // @UseGuards(AuthGuard('google'))
  googleAuth() {
    // Passport redirects to Google
  }

  @Get('google/callback')
  // @UseGuards(AuthGuard('google'))
  googleCallback(@Request() req: any) {
    return this.authService.handleGoogleCallback(req.user);
  }

  @Get('me')
  @ApiBearerAuth()
  // @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@Request() req: any) {
    return req.user;
  }
}
