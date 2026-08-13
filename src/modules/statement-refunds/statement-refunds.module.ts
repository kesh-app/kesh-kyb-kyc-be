import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { StatementRefundsController } from "./statement-refunds.controller";
import { StatementRefundsService } from "./statement-refunds.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [DbModule, NotificationsModule],
  controllers: [StatementRefundsController],
  providers: [StatementRefundsService],
})
export class StatementRefundsModule {}
