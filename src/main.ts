import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";

import * as express from "express";
import * as path from "path";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(",") || true,
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix("api");

  const uploadDir = path.resolve(
    process.cwd(),
    process.env.UPLOAD_DIR || "uploads"
  );
  app.use("/uploads", express.static(uploadDir));

  const port = process.env.API_PORT || 4000;
  await app.listen(port);
  console.log(`API running at http://localhost:${port}/api`);
}
bootstrap();
