import { BadRequestException, Body, Controller, Get, Logger, NotFoundException, Param, Patch, UseGuards } from '@nestjs/common';
import { GrammarSectionsService } from './grammar-sections.service';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';

@Controller('grammar-sections')
@UseGuards(FirebaseAuthGuard)
export class GrammarSectionsController {
    private readonly logger = new Logger(GrammarSectionsController.name);

    constructor(private readonly grammarSectionsService: GrammarSectionsService) { }

    @Get()
    async findAll() {
        const results = await this.grammarSectionsService.findAll();
        this.logger.log(`GET /grammar-sections — returned ${results.length}`);
        return results;
    }

    @Get(':id')
    async findOne(@Param('id') id: string) {
        const section = await this.grammarSectionsService.findById(id);
        if (!section) {
            throw new NotFoundException(`Grammar section ${id} not found`);
        }
        return section;
    }

    @Patch(':id')
    async updateNotes(@Param('id') id: string, @Body() body: { notes: string }) {
        if (typeof body.notes !== 'string') {
            throw new BadRequestException('notes must be a string');
        }
        await this.grammarSectionsService.updateNotes(id, body.notes);
        return { success: true };
    }
}
