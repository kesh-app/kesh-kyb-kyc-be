import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { ComplaintsController } from "./complaints.controller";
import { ComplaintsService } from "./complaints.service";

@Module({
  imports: [DbModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
})
export class ComplaintsModule {}
