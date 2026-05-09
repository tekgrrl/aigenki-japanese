import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { AdminGuard } from './admin.guard';

@Module({
  controllers: [AuthController],
  providers: [FirebaseAuthGuard, AdminGuard],
  exports: [FirebaseAuthGuard, AdminGuard],
})
export class AuthModule {}
