import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { json, urlencoded, type Request, type Response, type NextFunction } from 'express';
import { AppModule } from './app.module';

// JSON.stringify can't serialize BigInt natively — endpoints returning raw
// Prisma rows with BigInt columns (amounts in lovelace, etc.) used to 500.
// Teach BigInt how to serialize itself as a string ONCE here so every
// endpoint is safe. Clients parse `Number(value)` or `BigInt(value)` as
// needed. Defined as a non-enumerable property so it never leaks into
// JSON.stringify({...new BigInt}) iterations.
if (!('toJSON' in BigInt.prototype)) {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function () { return this.toString(); },
    writable: true,
    configurable: true,
  });
}

async function bootstrap() {
  // Disable Nest's default body parser (≈100 KB JSON limit) and register our own
  // with a higher cap — profile photos are sent inline as ~512 KB data URLs.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  // SEC-06 — behind exactly one reverse proxy (Caddy); makes req.ip the real client, not spoofable via x-forwarded-for.
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);
  expressApp.disable('x-powered-by');

  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());
  // SEC-08 — baseline security headers (HSTS is terminated at the TLS edge/Caddy).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // §25 — versioned API under /api/v1; health/metrics stay unprefixed (§25.6).
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'healthz', method: RequestMethod.GET },
      { path: 'internal/healthz', method: RequestMethod.GET },
      { path: 'internal/metrics', method: RequestMethod.GET },
      { path: 'internal/deploy/readiness', method: RequestMethod.GET },
      { path: 'readyz', method: RequestMethod.GET },
      { path: 'internal/readyz', method: RequestMethod.GET },
    ],
  });

  const origins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  // SEC-08 — require an explicit CORS allowlist in production (credentialed CORS + '*' is unsafe).
  const isProd = config.get<string>('NODE_ENV') === 'production' || config.get<string>('CARDANO_NETWORK') === 'Mainnet';
  if (isProd && (origins.length === 0 || origins.includes('*'))) {
    throw new Error('CORS_ORIGINS must be an explicit allowlist in production (no "*" or empty)');
  }
  app.enableCors({ origin: origins, credentials: true });

  const port = Number(config.get('API_PORT') ?? 4000);
  await app.listen(port);
  Logger.log(`DRep DAO API listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
