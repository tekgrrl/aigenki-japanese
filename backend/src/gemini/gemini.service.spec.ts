import { InternalServerErrorException, Logger } from '@nestjs/common';
import { GeminiService } from './gemini.service';

// Checks the shared api-logs bookkeeping (logged()) and that each caller still gets the
// error it got before: the log records the original error, the caller its own exception.
describe('GeminiService logging', () => {
  let service: GeminiService;
  let generateContent: jest.Mock;
  let apilog: { startLog: jest.Mock; completeLog: jest.Mock };
  const logRef = { id: 'log1' };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    apilog = { startLog: jest.fn().mockResolvedValue(logRef), completeLog: jest.fn().mockResolvedValue(undefined) };
    generateContent = jest.fn();
    service = new GeminiService({ get: () => undefined } as any, apilog as any);
    Object.assign(service as any, { client: { models: { generateContent } }, modelName: 'm', conceptModelName: 'cm' });
  });

  afterEach(() => jest.restoreAllMocks());

  const completed = () => apilog.completeLog.mock.calls[0][1];

  it('logs a successful call with the parsed response and a duration in milliseconds', async () => {
    const text = '{"result":"pass","explanation":"ok"}';
    generateContent.mockResolvedValue({ text });

    const result = await service.evaluateAnswer('prompt', 'a', ['a'], { topic: 't' });

    expect(result).toEqual({ result: 'pass', explanation: 'ok' });
    expect(apilog.startLog).toHaveBeenCalledWith(expect.objectContaining({
      route: '/reviews/evaluate', status: 'pending', modelUsed: 'm',
      requestData: expect.objectContaining({ userMessage: 'prompt', input_topic: 't' }),
    }));
    expect(completed()).toEqual(expect.objectContaining({
      status: 'success', responseData: { rawText: text, parsedJson: result },
    }));
    expect(typeof completed().durationMs).toBe('number');
  });

  it('logs the original error with its stack, then throws the caller-facing 500', async () => {
    generateContent.mockRejectedValue(new Error('network down'));

    const err = await service.evaluateAnswer('prompt', 'a', ['a']).catch(e => e);

    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect(err.getResponse()).toEqual(expect.objectContaining({ error: 'Network error during API call: network down' }));
    expect(completed()).toEqual(expect.objectContaining({
      status: 'error', errorData: expect.objectContaining({ message: 'network down', stack: expect.any(String) }),
    }));
  });

  it('treats an empty response as an error', async () => {
    generateContent.mockResolvedValue({ text: '' });

    await expect(service.generateChatResponse('sys', 'hi')).rejects.toThrow('Failed to generate chat response');
    expect(completed()).toEqual(expect.objectContaining({
      status: 'error', errorData: expect.objectContaining({ message: 'Empty response text from Gemini' }),
    }));
  });

  it('trims text around the JSON object for lessons', async () => {
    generateContent.mockResolvedValue({ text: 'thinking… {"a":1} done' });

    await expect(service.generateLesson('msg')).resolves.toBe('{"a":1}');
    expect(completed().responseData).toEqual({ parsedJson: '{"a":1}' });
  });

  it('returns null from buildExampleUsages on failure, still logging the error', async () => {
    generateContent.mockResolvedValue({ text: 'not json' });

    await expect(service.buildExampleUsages('語', [], [], [], 'ku1')).resolves.toBeNull();
    expect(completed().status).toBe('error');
    expect(completed().errorData.message).toContain('Failed to parse AI JSON response');
  });

  it('uses the concept model for concepts', async () => {
    generateContent.mockResolvedValue({ text: '{"c":1}' });

    await service.generateConcept('msg', { topic: 'x' });

    expect(apilog.startLog).toHaveBeenCalledWith(expect.objectContaining({ route: '/concepts/generate', modelUsed: 'cm' }));
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: 'cm' }));
  });
});
