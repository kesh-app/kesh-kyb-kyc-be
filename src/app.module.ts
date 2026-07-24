import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './modules/db/db.module';
import { HealthController } from './modules/health/health.controller';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { BusinessModule } from './modules/business/business.module';
import { WatchlistModule } from './modules/watchlist/watchlist.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { RegistrantsModule } from './modules/registrants/registrants.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { ReferencesModule } from './modules/references/references.module';
import { ComplaintsModule } from './modules/complaints/complaints.module';
import { ReportsModule } from './modules/reports/reports.module';
import { DataReviewsModule } from './modules/data-reviews/data-reviews.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DbModule, UsersModule, AuthModule, ApplicationsModule, UploadsModule, BusinessModule, WatchlistModule, DashboardModule, RegistrantsModule, TransfersModule, MonitoringModule, ReferencesModule, ComplaintsModule, ReportsModule, DataReviewsModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
