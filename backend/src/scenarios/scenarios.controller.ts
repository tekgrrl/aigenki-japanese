import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  HttpException,
  HttpStatus,
  ParseIntPipe,
  BadRequestException,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ScenariosService } from './scenarios.service';
import { GenerateScenarioDto, ImportScenarioDto, ChatTurnDto, ResetSessionDto } from '../types/scenario';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UserId } from '../auth/user-id.decorator';
import { ALLOWED_USER_ROLES, ALLOWED_AI_ROLES } from '../prompts/scenario.prompts';

@Controller('scenarios')
@UseGuards(FirebaseAuthGuard)
export class ScenariosController {
  constructor(private readonly scenariosService: ScenariosService) { }

  @Get('templates')
  getTemplates() {
    return this.scenariosService.getTemplates();
  }

  @Get('roles')
  getRoles() {
    return { userRoles: ALLOWED_USER_ROLES, aiRoles: ALLOWED_AI_ROLES };
  }

  @Post('generate')
  async generateScenario(@UserId() uid: string, @Body() dto: GenerateScenarioDto) {
    const id = await this.scenariosService.generateScenario(uid, dto);
    return { id };
  }

  @Post('regenerate-from-flag/:flagId')
  @UseGuards(AdminGuard)
  async regenerateFromFlag(@Param('flagId') flagId: string) {
    return this.scenariosService.regenerateFromFlag(flagId);
  }

  @Post('import')
  async importScenario(@UserId() uid: string, @Body() dto: ImportScenarioDto) {
    const hasAiRole = dto.aiRole || (dto.aiRoles && dto.aiRoles.length > 0);
    if (!dto.conversationText || !dto.userRole || !hasAiRole) {
      throw new BadRequestException('conversationText, userRole, and at least one aiRole are required');
    }
    const id = await this.scenariosService.importScenario(uid, dto);
    return { id };
  }

  @Get()
  async getAllScenarios(
    @UserId() uid: string,
    @Query('days') days?: string,
    @Query('sourceKuId') sourceKuId?: string,
    @Query('sourceSectionId') sourceSectionId?: string,
    @Query('state') state?: string,
  ) {
    if (sourceKuId) {
      return this.scenariosService.getScenariosBySourceKuId(uid, sourceKuId);
    }
    if (sourceSectionId) {
      return this.scenariosService.getScenariosBySourceSectionId(uid, sourceSectionId);
    }
    const limitDays = days ? parseInt(days, 10) : undefined;
    if (limitDays !== undefined && isNaN(limitDays)) {
      throw new BadRequestException('Invalid days parameter');
    }
    return this.scenariosService.getAllScenarios(uid, limitDays, state);
  }

  @Get(':id/ku-status')
  async getKuStatus(@UserId() uid: string, @Param('id') id: string) {
    return this.scenariosService.getKuStatus(uid, id);
  }

  /** Draw the scenario's setting in the background (explicit only: it costs an image call). */
  @Post(':id/picture')
  async drawScene(@UserId() uid: string, @Param('id') id: string) {
    return this.scenariosService.startScenePicture(uid, id);
  }

  @Get(':id/picture/status')
  async sceneStatus(@UserId() uid: string, @Param('id') id: string) {
    return this.scenariosService.getSceneStatus(uid, id);
  }

  /** The scene image (authenticated: fetched via apiFetch, shown as a blob URL). */
  @Get(':id/picture')
  async scenePicture(@UserId() uid: string, @Param('id') id: string, @Res() res: Response) {
    const file = await this.scenariosService.scenePicturePath(uid, id);
    if (!file) throw new HttpException('No scene picture', HttpStatus.NOT_FOUND);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(file);
  }

  @Get(':id')
  async getScenario(@UserId() uid: string, @Param('id') id: string) {
    const scenario = await this.scenariosService.getScenario(uid, id);
    if (!scenario) {
      throw new HttpException('Scenario not found', HttpStatus.NOT_FOUND);
    }
    return scenario;
  }

  @Post(':id/advance')
  async advanceState(@UserId() uid: string, @Param('id') id: string) {
    return this.scenariosService.advanceState(uid, id);
  }

  @Post(':id/reset')
  async resetSession(@UserId() uid: string, @Param('id') id: string, @Body() body: ResetSessionDto) {
    await this.scenariosService.resetSession(uid, id, body.archive);
    return { success: true };
  }

  @Post(':id/deactivate')
  async deactivateScenario(@UserId() uid: string, @Param('id') id: string) {
    await this.scenariosService.deactivateScenario(uid, id);
    return { success: true };
  }

  @Post(':id/chat')
  async handleChat(@UserId() uid: string, @Param('id') id: string, @Body() dto: ChatTurnDto) {
    return this.scenariosService.handleChat(uid, id, dto.userMessage);
  }
}