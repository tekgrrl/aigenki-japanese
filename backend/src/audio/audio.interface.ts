
export interface ITtsProvider {
    /**
     * Generates audio from the given text.
     * @param text The text to convert to speech.
     * @param voice Optional voice name (one of CHIRP3_HD_JA_VOICES); the app's default voice when absent.
     * @returns A Promise that resolves to a Buffer containing the audio data (e.g., MP3).
     */
    generateAudio(text: string, voice?: string): Promise<Buffer>;
}
