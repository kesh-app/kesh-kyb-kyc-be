import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ApplicationsService } from './applications.service';
import { ApplicationsController } from './applications.controller';
import { UploadsModule } from '../uploads/uploads.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [DbModule, UploadsModule, NotificationsModule],
  providers: [ApplicationsService],
  controllers: [ApplicationsController],
})
export class ApplicationsModule {}
