import { Controller, Get, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { KanjiService } from './kanji.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { UserId } from '../auth/user-id.decorator';

@Controller('kanji')
@UseGuards(FirebaseAuthGuard)
export class KanjiController {
    constructor(private readonly kanjiService: KanjiService) { }

    @Get('words')
    async getWords(
        @UserId() uid: string,
        @Query('char') char: string,
        @Query('from') from?: string,
    ) {
        if (!char) throw new BadRequestException('Kanji character (char) is required');
        return this.kanjiService.getWordsUsing(uid, char, from);
    }

    @Get('details')
    async getDetails(
        @UserId() uid: string,
        @Query('char') char: string,
        @Query('kuId') kuId?: string
    ) {
        if (!char) {
            throw new BadRequestException('Kanji character (char) is required');
        }
        return this.kanjiService.getKanjiDetails(uid, char, kuId);
    }
}