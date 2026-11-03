
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { ITtsProvider } from './audio.interface';

/** Every ja-JP Chirp3-HD voice, confirmed live via `client.listVoices({ languageCode: 'ja-JP' })`. Selectable from the pronunciation-practice tool's voice picker. */
export const CHIRP3_HD_JA_VOICES = [
    'ja-JP-Chirp3-HD-Achernar', 'ja-JP-Chirp3-HD-Achird', 'ja-JP-Chirp3-HD-Algenib',
    'ja-JP-Chirp3-HD-Algieba', 'ja-JP-Chirp3-HD-Alnilam', 'ja-JP-Chirp3-HD-Aoede',
    'ja-JP-Chirp3-HD-Autonoe', 'ja-JP-Chirp3-HD-Callirrhoe', 'ja-JP-Chirp3-HD-Charon',
    'ja-JP-Chirp3-HD-Despina', 'ja-JP-Chirp3-HD-Enceladus', 'ja-JP-Chirp3-HD-Erinome',
    'ja-JP-Chirp3-HD-Fenrir', 'ja-JP-Chirp3-HD-Gacrux', 'ja-JP-Chirp3-HD-Iapetus',
    'ja-JP-Chirp3-HD-Kore', 'ja-JP-Chirp3-HD-Laomedeia', 'ja-JP-Chirp3-HD-Leda',
    'ja-JP-Chirp3-HD-Orus', 'ja-JP-Chirp3-HD-Puck', 'ja-JP-Chirp3-HD-Pulcherrima',
    'ja-JP-Chirp3-HD-Rasalgethi', 'ja-JP-Chirp3-HD-Sadachbia', 'ja-JP-Chirp3-HD-Sadaltager',
    'ja-JP-Chirp3-HD-Schedar', 'ja-JP-Chirp3-HD-Sulafat', 'ja-JP-Chirp3-HD-Umbriel',
    'ja-JP-Chirp3-HD-Vindemiatrix', 'ja-JP-Chirp3-HD-Zephyr', 'ja-JP-Chirp3-HD-Zubenelgenubi',
] as const;

@Injectable()
export class GoogleTtsService implements ITtsProvider {
    private client: TextToSpeechClient;
    private readonly logger = new Logger(GoogleTtsService.name);

    constructor(private configService: ConfigService) {
        const projectId = this.configService.get<string>('GOOGLE_CLOUD_PROJECT');
        this.client = new TextToSpeechClient({ projectId });
    }

    /** The app's voice (all `/audio/speak` callers and the pronunciation tool's default): Chirp3-HD, Google's most natural-sounding ja-JP tier. Confirmed to support SSML `<break>` on synchronous requests via `client.listVoices` + a live test call. Overridable per-request via `opts.voiceName`. */
    private static readonly CHIRP3_HD_JA_VOICE = 'ja-JP-Chirp3-HD-Orus';
    private static readonly FALLBACK_JA_VOICE = 'ja-JP-Neural2-B';

    /**
     * Used by app audio (via `generateAudio`) and the pronunciation-practice tool.
     * Accepts either plain text or pre-built SSML (never both — discriminated union),
     * and falls back once to the Neural2 voice if the preferred Chirp3-HD voice
     * fails for any reason, so a bad voice name or a transient error doesn't
     * hard-fail playback.
     */
    async synthesize(
        input: { text: string } | { ssml: string },
        opts: { voiceName?: string } = {},
    ): Promise<{ audio: Buffer; voiceUsed: string }> {
        const preferredVoice = opts.voiceName ?? GoogleTtsService.CHIRP3_HD_JA_VOICE;

        const synthesizeWith = async (voiceName: string): Promise<Buffer> => {
            const request = {
                input: 'ssml' in input ? { ssml: input.ssml } : { text: input.text },
                voice: { languageCode: 'ja-JP', name: voiceName },
                audioConfig: { audioEncoding: 'MP3' as const },
            };
            const [response] = await this.client.synthesizeSpeech(request);
            if (!response.audioContent) {
                throw new Error('No audio content received from Google TTS');
            }
            return Buffer.from(response.audioContent);
        };

        try {
            return { audio: await synthesizeWith(preferredVoice), voiceUsed: preferredVoice };
        } catch (error) {
            this.logger.warn(`synthesize: voice "${preferredVoice}" failed, retrying with "${GoogleTtsService.FALLBACK_JA_VOICE}"`, error);
            const audio = await synthesizeWith(GoogleTtsService.FALLBACK_JA_VOICE);
            return { audio, voiceUsed: GoogleTtsService.FALLBACK_JA_VOICE };
        }
    }

    /**
     * App audio (`/audio/speak`): the default Chirp3-HD voice, falling back once to Neural2.
     * Text without closing punctuation gets a 。: given a bare kana word (e.g. a reading like
     * こうきょうりょうきん), Chirp3-HD sometimes inserts a ~0.7s phrase break mid-word, which
     * the full stop prevents (measured: 4 of 11 bare-kana renders paused, 0 of 6 with 。).
     */
    async generateAudio(text: string): Promise<Buffer> {
        const trimmed = text.trim();
        const input = /[。．.！!？?…」』）)]$/.test(trimmed) ? trimmed : `${trimmed}。`;
        try {
            return (await this.synthesize({ text: input })).audio;
        } catch (error) {
            this.logger.error(`Failed to generate audio for text: "${text.substring(0, 20)}..."`, error);
            throw error;
        }
    }
}
