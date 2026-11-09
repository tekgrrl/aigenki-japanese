import { Global, Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { LevelSyncService } from './level-sync.service';

@Global()
@Module({
  controllers: [UserController],
  providers: [UserService, LevelSyncService],
  exports: [UserService],
})
export class UserModule {}
