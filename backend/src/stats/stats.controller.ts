import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { StatsService } from './stats.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { UserId } from '../auth/user-id.decorator';

@Controller('stats')
@UseGuards(FirebaseAuthGuard)
export class StatsController {
    constructor(private readonly statsService: StatsService) { }

    @Get()
    async getStats(@UserId() uid: string) {
        return this.statsService.getDashboardStats(uid);
    }

    /** Dashboard "Hardest items": ?by=card (default) or ?by=ku. */
    @Get('hardest')
    async getHardest(@UserId() uid: string, @Query('by') by?: string) {
        return this.statsService.getHardest(uid, by === 'ku' ? 'ku' : 'card');
    }

    @Get('schedule/:date/hourly')
    async getHourlyBreakdown(@UserId() uid: string, @Param('date') date: string) {
        return this.statsService.getHourlyBreakdown(uid, date);
    }
}
