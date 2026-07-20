import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [DbModule, UploadsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
