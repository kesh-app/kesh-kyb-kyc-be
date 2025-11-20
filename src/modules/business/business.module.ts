import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { BusinessService } from './business.service';
import { BusinessController } from './business.controller';

@Module({
  imports: [DbModule],
  providers: [BusinessService],
  controllers: [BusinessController],
})
export class BusinessModule {}
