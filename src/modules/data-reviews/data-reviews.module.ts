import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import {
  DataReviewsController,
  DataReviewsListController,
} from "./data-reviews.controller";
import { DataReviewsService } from "./data-reviews.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [DbModule, NotificationsModule],
  controllers: [DataReviewsListController, DataReviewsController],
  providers: [DataReviewsService],
})
export class DataReviewsModule {}
