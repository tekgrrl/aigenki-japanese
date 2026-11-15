import { Module } from '@nestjs/common';
import { JourneysController } from './journeys.controller';
import { JourneysService } from './journeys.service';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { UserModule } from '../users/user.module';
import { AuthModule } from '../auth/auth.module';

/** Journeys: ordered phases of pool scenarios, the course structure (Journeys build step 4). */
@Module({
  imports: [ScenariosModule, UserModule, AuthModule],
  controllers: [JourneysController],
  providers: [JourneysService],
})
export class JourneysModule {}
