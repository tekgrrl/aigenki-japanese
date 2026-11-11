import { ForbiddenException } from '@nestjs/common';
import { KnowledgeUnitsController } from './knowledge-units.controller';

/** POST /knowledge-units: anyone can enrol an existing word; only an admin can create a new global one. */
describe('KnowledgeUnitsController.create', () => {
  const setup = (opts: { existing?: { id: string }; admin: boolean }) => {
    const kus = {
      findByContent: jest.fn().mockResolvedValue(opts.existing ?? null),
      create: jest.fn().mockResolvedValue({ id: 'new-ku' }),
    };
    const ukus = { create: jest.fn().mockResolvedValue(undefined) };
    const users = { isAdmin: jest.fn().mockResolvedValue(opts.admin) };
    const controller = new KnowledgeUnitsController(kus as any, ukus as any, users as any);
    return { controller, kus, ukus };
  };

  it('enrols a learner in an existing word without creating anything', async () => {
    const { controller, kus, ukus } = setup({ existing: { id: 'ku1' }, admin: false });
    expect(await controller.create('learner', { type: 'Vocab', content: '水' })).toEqual({ id: 'ku1', isNew: false });
    expect(kus.create).not.toHaveBeenCalled();
    expect(ukus.create).toHaveBeenCalledWith('learner', 'ku1');
  });

  it('refuses a learner who tries to create a new word', async () => {
    const { controller, kus, ukus } = setup({ admin: false });
    await expect(controller.create('learner', { type: 'Vocab', content: '新語' })).rejects.toThrow(ForbiddenException);
    expect(kus.create).not.toHaveBeenCalled();
    expect(ukus.create).not.toHaveBeenCalled();
  });

  it('lets an admin create a new word, keeping only type, content and data', async () => {
    const { controller, kus } = setup({ admin: true });
    const body = { type: 'Grammar', content: '〜ので', data: { meaning: 'because' }, scenarioReady: true, jlptLevel: 'N1' };
    expect(await controller.create('admin', body)).toEqual({ id: 'new-ku', isNew: true });
    expect(kus.create).toHaveBeenCalledWith({ type: 'Grammar', content: '〜ので', data: { meaning: 'because' } });
  });
});
