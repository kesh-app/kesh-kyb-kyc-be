import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { ComplaintsController } from "./complaints.controller";
import { ComplaintsService } from "./complaints.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [DbModule, NotificationsModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
})
export class ComplaintsModule {}
