import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ApplicationsService } from './applications.service';
import { ApplicationsController } from './applications.controller';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [DbModule, UploadsModule],
  providers: [ApplicationsService],
  controllers: [ApplicationsController],
})
export class ApplicationsModule {}
