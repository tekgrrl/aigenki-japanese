import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UserId } from '../auth/user-id.decorator';
import { JourneysService } from './journeys.service';
import type { JourneyInput } from './journeys.service';

@Controller('journeys')
@UseGuards(FirebaseAuthGuard)
export class JourneysController {
  constructor(private readonly journeys: JourneysService) {}

  /** The course for this learner: Journeys with status, phases, choices and current goal progress. */
  @Get()
  forLearner(@UserId() uid: string) {
    return this.journeys.forLearner(uid);
  }

  /** Admin (Journey planner): every Journey in order, names for stored ids, and each phase's allowed items. */
  @Get('admin')
  @UseGuards(AdminGuard)
  listForPlanner() {
    return this.journeys.listForPlanner();
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() body: JourneyInput) {
    return this.journeys.create(body);
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() body: JourneyInput) {
    return this.journeys.update(id, body);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  async remove(@Param('id') id: string) {
    await this.journeys.remove(id);
    return { success: true };
  }
}
