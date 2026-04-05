import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3001);
  const clientUrl = config.get<string>('CLIENT_URL', 'http://localhost:3000');

  // Security
  app.use(helmet());
  app.enableCors({
    origin: [clientUrl, /\.goboki\.com$/],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Swagger API docs
  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('GOBOKI API')
      .setDescription('Travel SaaS Platform — Booking & Operations API')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication & Authorization')
      .addTag('bookings', 'Reservation Management')
      .addTag('experiences', 'Products & Experiences')
      .addTag('customers', 'CRM & Customer Profiles')
      .addTag('payments', 'Payments, Invoices & Refunds')
      .addTag('availability', 'Calendar & Availability')
      .addTag('analytics', 'Reports & Analytics')
      .addTag('website', 'Website Builder')
      .addTag('tenants', 'Multi-Tenant Workspace')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
  }

  await app.listen(port);
  logger.log(`GOBOKI API running on http://localhost:${port}/api/v1`);
}
bootstrap();
