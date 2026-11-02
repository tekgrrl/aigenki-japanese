import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PicturesController } from './pictures.controller';
import { PicturesService } from './pictures.service';

@Module({
  imports: [AuthModule, ConfigModule],
  providers: [PicturesService],
  controllers: [PicturesController],
  exports: [PicturesService],
})
export class PicturesModule {}
