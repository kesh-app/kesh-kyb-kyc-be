// src/modules/registrants/registrants.module.ts
import { Module } from '@nestjs/common';
import { RegistrantsController } from './registrants.controller';

@Module({ controllers: [RegistrantsController] })
export class RegistrantsModule {}
