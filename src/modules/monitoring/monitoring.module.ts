import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { MonitoringController } from "./monitoring.controller";
import { MonitoringService } from "./monitoring.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [DbModule, NotificationsModule],
  controllers: [MonitoringController],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
