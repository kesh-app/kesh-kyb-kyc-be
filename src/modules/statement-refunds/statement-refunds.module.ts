import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { StatementRefundsController } from "./statement-refunds.controller";
import { StatementRefundsService } from "./statement-refunds.service";

@Module({
  imports: [DbModule],
  controllers: [StatementRefundsController],
  providers: [StatementRefundsService],
})
export class StatementRefundsModule {}
