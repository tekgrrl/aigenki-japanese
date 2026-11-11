
import { Controller, Post, Body, Res, Logger, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AudioService } from './audio.service';
import { PronounceDto } from './dto/pronounce.dto';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';

@Controller('audio')
export class AudioController {
    private readonly logger = new Logger(AudioController.name);

    constructor(private readonly audioService: AudioService) { }

    @Post('speak')
    @UseGuards(FirebaseAuthGuard)
    async speak(@Body('text') text: string, @Res() res: Response) {
        if (!text) {
            return res.status(400).send('Text is required');
        }

        try {
            const audioBuffer = await this.audioService.getAudioStream(text);

            res.set({
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBuffer.length,
                'Cache-Control': 'public, max-age=31536000',
            });

            res.send(audioBuffer);
        } catch (error) {
            this.logger.error('Error generating speech', error);
            res.status(500).send('Error generating speech');
        }
    }

    /**
     * Standalone pronunciation-practice tool. Guarded (unlike `/speak`) since
     * it fans out to a pricier voice tier and, in "paced" mode, an LLM call.
     */
    @UseGuards(FirebaseAuthGuard)
    @Post('pronounce')
    async pronounce(@Body() dto: PronounceDto, @Res() res: Response) {
        try {
            const { audio, voiceUsed, segmentation } = await this.audioService.pronounce(dto);

            res.set({
                'Content-Type': 'audio/mpeg',
                'Content-Length': audio.length,
                'X-Pronounce-Voice': voiceUsed,
                'X-Pronounce-Segmentation': segmentation,
                // mode/pauseMs/fallback outcome all vary the response for the
                // same text — unlike /speak, this must never be cached.
                'Cache-Control': 'no-store',
            });

            res.send(audio);
        } catch (error) {
            this.logger.error('Error generating pronunciation audio', error);
            res.status(500).send('Error generating pronunciation audio');
        }
    }
}
