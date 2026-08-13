import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import * as path from 'path';
import { corsOriginList, isOriginAllowed } from './common/cors-origin';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowList = corsOriginList();

  app.enableCors({
    origin: (origin, cb) =>
      isOriginAllowed(origin, allowList) ? cb(null, true) : cb(new Error('Not allowed by CORS')),
    methods: ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization'],
    exposedHeaders: ['Content-Disposition'],
    credentials: false, // pakai Bearer token, bukan cookie
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');

  // Serve uploaded files for LOCAL storage under /api/uploads.
  // Must be under /api/ to match signed URLs generated from BASE_URL (which includes /api).
  const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
  app.use(
    '/api/uploads',
    express.static(uploadDir, {
      fallthrough: false,
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    }),
  );
  console.log(`[STORAGE] Local uploads static route enabled: /api/uploads -> ${uploadDir}`);

  // Warn early if OBS is configured but env vars are missing
  if ((process.env.STORAGE_PROVIDER || '').toUpperCase() === 'HUAWEI_OBS') {
    const obsRequired = [
      'OBS_BUCKET_NAME', 'OBS_REGION', 'OBS_ENDPOINT',
      'HUAWEI_OBS_ACCESS_KEY_ID', 'HUAWEI_OBS_SECRET_ACCESS_KEY',
    ];
    const missing = obsRequired.filter((k) => !process.env[k]);
    if (missing.length) {
      console.error(
        `[STORAGE] STORAGE_PROVIDER=HUAWEI_OBS but missing: ${missing.join(', ')} — will fall back to LOCAL`,
      );
    }
  }

  const port = Number(process.env.API_PORT) || 4000;
  await app.listen(port);
  console.log(`API running at http://localhost:${port}/api`);
}
bootstrap();
