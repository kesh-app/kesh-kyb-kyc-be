import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './modules/db/db.module';
import { HealthController } from './modules/health/health.controller';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { UploadsModule } from './modules/uploads/uploads.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DbModule, UsersModule, AuthModule, ApplicationsModule, UploadsModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
