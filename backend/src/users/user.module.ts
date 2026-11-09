import { Global, Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { StatsModule } from '../stats/stats.module';
import { LevelSyncService } from './level-sync.service';

@Global()
@Module({
  imports: [StatsModule],
  controllers: [UserController],
  providers: [UserService, LevelSyncService],
  exports: [UserService],
})
export class UserModule {}
