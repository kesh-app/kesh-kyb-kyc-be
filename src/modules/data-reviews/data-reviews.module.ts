import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import {
  DataReviewsController,
  DataReviewsListController,
  DataReviewDraftsController,
} from "./data-reviews.controller";
import { DataReviewsService } from "./data-reviews.service";
import { DataReviewDraftsService } from "./data-review-drafts.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { UploadsModule } from "../uploads/uploads.module";

@Module({
  imports: [DbModule, NotificationsModule, UploadsModule],
  // Urutan penting: DataReviewDraftsController memakai path "data-reviews/:reviewId/...",
  // DataReviewsListController memakai "data-reviews" — keduanya tidak bertabrakan
  // karena segmen kedua selalu ada di controller draft.
  controllers: [
    DataReviewsListController,
    DataReviewDraftsController,
    DataReviewsController,
  ],
  providers: [DataReviewsService, DataReviewDraftsService],
})
export class DataReviewsModule {}
