import { Controller, Get, Put, Patch, Delete, Param, Body, Query, Post, BadRequestException, NotFoundException, UseGuards, HttpCode, Logger } from '@nestjs/common';
import { KnowledgeUnitsService } from './knowledge-units.service';
import { UserKnowledgeUnitsService } from '../user-knowledge-units/user-knowledge-units.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UserId } from '../auth/user-id.decorator';
import { ParseArrayPipe } from '@nestjs/common/pipes';


@Controller('knowledge-units')
@UseGuards(FirebaseAuthGuard)
export class KnowledgeUnitsController {
    private readonly logger = new Logger(KnowledgeUnitsController.name);

    constructor(
        private readonly knowledgeUnitsService: KnowledgeUnitsService,
        private readonly userKnowledgeUnitsService: UserKnowledgeUnitsService,
    ) { }

    @Get('get-all')
    async findAll(
        @UserId() uid: string,
        @Query('status') status?: string,
        @Query('type') type?: string,
        @Query('jlptLevel') jlptLevel?: string,
        @Query('content', new ParseArrayPipe({ items: String, separator: ',', optional: true })) content?: string[]
    ) {
        if (status === 'learning') {
            return this.userKnowledgeUnitsService.findLearningQueueAsKUs(uid);
        }
        if (status === 'user') {
            return this.userKnowledgeUnitsService.findAllAsKUs(uid);
        }
        return this.knowledgeUnitsService.findAll({ status, type, content, jlptLevel });
    }

    @Put(':id')
    async update(@Param('id') id: string, @Body() body: any) {
        return this.knowledgeUnitsService.update(id, body);
    }

    @Get('search')
    async search(
        @Query('q') q: string,
        @Query('type') type?: string,
        @Query('jlptLevel') jlptLevel?: string,
        @Query('excludeType') excludeType?: string,
    ) {
        if (!q || q.trim().length === 0) return [];
        return this.knowledgeUnitsService.search(q.trim(), type, jlptLevel, excludeType);
    }

    /** Admin KU list: search and/or filter the whole corpus, one page at a time, with the total. */
    @Get('browse')
    @UseGuards(AdminGuard)
    async browse(
        @Query('q') q?: string,
        @Query('type') type?: string,
        @Query('jlptLevel') jlptLevel?: string,
        @Query('page') page?: string,
        @Query('pageSize') pageSize?: string,
    ) {
        return this.knowledgeUnitsService.browse({
            q,
            type: type || undefined,
            jlptLevel: jlptLevel || undefined,
            page: page ? Number(page) || 1 : 1,
            pageSize: pageSize ? Number(pageSize) || 50 : 50,
        });
    }

    @Get(':id')
    async findOne(@UserId() uid: string, @Param('id') id: string) {
        const ku = await this.knowledgeUnitsService.findOneById(id);
        if (!ku) throw new NotFoundException(`Knowledge Unit ${id} not found`);

        const uku = await this.userKnowledgeUnitsService.findByKuId(uid, id);
        if (uku) return ku;

        throw new NotFoundException(`Knowledge Unit ${id} not found`);
    }

    // Admin-only lookup with no per-user enrollment gate — the plain :id route above
    // requires the caller to have their own UKU for the KU (it's a "can I view what
    // I'm learning" check), which is wrong for an admin editing arbitrary global
    // corpus data they may never have personally enrolled in.
    @Get(':id/global')
    @UseGuards(AdminGuard)
    async findOneGlobal(@Param('id') id: string) {
        const ku = await this.knowledgeUnitsService.findOneById(id);
        if (!ku) throw new NotFoundException(`Knowledge Unit ${id} not found`);
        return ku;
    }

    @Patch('bulk')
    @HttpCode(200)
    async bulkUpdate(@Body() body: any) {
        if (!Array.isArray(body)) {
            throw new BadRequestException('Request body must be an array of Knowledge Units');
        }
        return this.knowledgeUnitsService.bulkUpdate(body);
    }

    @Post('bulk')
    @HttpCode(200)
    async bulkIngest(@Body() body: any) {
        if (!Array.isArray(body)) {
            throw new BadRequestException('Request body must be an array of Knowledge Units');
        }
        return this.knowledgeUnitsService.bulkIngest(body);
    }

    @Delete(':id')
    async remove(@UserId() uid: string, @Param('id') id: string) {
        return this.knowledgeUnitsService.cascadeDelete(uid, id);
    }

    @Post('migrate/vocab-kanji')
    @UseGuards(AdminGuard)
    async backfillVocabKanji() {
        this.logger.log('backfillVocabKanji called');
        return this.knowledgeUnitsService.backfillVocabKanji();
    }

    @Post('migrate/grammar-jlpt-level')
    @UseGuards(AdminGuard)
    async migrateGrammarJlptLevel() {
        this.logger.log('migrateGrammarJlptLevel called');
        return this.knowledgeUnitsService.migrateGrammarJlptLevel();
    }

    @Post('migrate/grammar-corpus-notes')
    @UseGuards(AdminGuard)
    async migrateGrammarCorpusNotes() {
        this.logger.log('migrateGrammarCorpusNotes called');
        return this.knowledgeUnitsService.migrateGrammarExplanationToCorpusNotes();
    }

    @Post()
    async create(@UserId() uid: string, @Body() body: any) {
        if (!body.content || !body.type) {
            throw new BadRequestException('Content and Type are required');
        }

        // Find-or-create the global KU
        const existing = await this.knowledgeUnitsService.findByContent(body.content, body.type);
        let kuId: string;
        let isNewKu: boolean;

        if (existing) {
            kuId = existing.id;
            isNewKu = false;
        } else {
            const created = await this.knowledgeUnitsService.create(body);
            kuId = created.id;
            isNewKu = true;
        }

        // Link the KU to the user (idempotent)
        await this.userKnowledgeUnitsService.create(uid, kuId);

        return { id: kuId, isNew: isNewKu };
    }

}
