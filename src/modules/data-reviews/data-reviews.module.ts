import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { DataReviewsController } from "./data-reviews.controller";
import { DataReviewsService } from "./data-reviews.service";

@Module({
  imports: [DbModule],
  controllers: [DataReviewsController],
  providers: [DataReviewsService],
})
export class DataReviewsModule {}
