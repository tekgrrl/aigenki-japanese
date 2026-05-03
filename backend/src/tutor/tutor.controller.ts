import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { TutorService, TutorGenerateScenarioDto } from './tutor.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { UserId } from '../auth/user-id.decorator';

@Controller('tutor')
@UseGuards(FirebaseAuthGuard)
export class TutorController {
  constructor(private readonly tutorService: TutorService) {}

  @Post('generate-scenario')
  async generateScenario(
    @UserId() uid: string,
    @Body() dto: TutorGenerateScenarioDto,
  ) {
    const id = await this.tutorService.generateScenario(uid, dto);
    return { id };
  }
}
