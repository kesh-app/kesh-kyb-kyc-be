import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [DbModule, MonitoringModule, NotificationsModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
