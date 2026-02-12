import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [DbModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
