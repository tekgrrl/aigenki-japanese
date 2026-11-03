import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PicturesController } from './pictures.controller';
import { PicturesService } from './pictures.service';
import { PictureRenderer } from './picture-renderer';

@Module({
  imports: [AuthModule, ConfigModule],
  providers: [PicturesService, PictureRenderer],
  controllers: [PicturesController],
  exports: [PicturesService, PictureRenderer],
})
export class PicturesModule {}
