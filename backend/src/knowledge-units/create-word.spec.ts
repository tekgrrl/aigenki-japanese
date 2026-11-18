import { ForbiddenException } from '@nestjs/common';
import { KnowledgeUnitsController } from './knowledge-units.controller';

/** POST /knowledge-units: anyone can enrol an existing word; only an admin can create a new global one. */
describe('KnowledgeUnitsController.create', () => {
  const setup = (opts: { existing?: { id: string; data?: any }; admin: boolean }) => {
    const kus = {
      findByContent: jest.fn().mockResolvedValue(opts.existing ?? null),
      create: jest.fn().mockResolvedValue({ id: 'new-ku' }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const ukus = { create: jest.fn().mockResolvedValue(undefined) };
    const users = { isAdmin: jest.fn().mockResolvedValue(opts.admin) };
    const controller = new KnowledgeUnitsController(kus as any, ukus as any, users as any);
    return { controller, kus, ukus };
  };

  it('enrols a learner in an existing word without creating anything', async () => {
    const { controller, kus, ukus } = setup({ existing: { id: 'ku1' }, admin: false });
    expect(await controller.create('learner', { type: 'Vocab', content: '水' })).toEqual({ id: 'ku1', isNew: false, noteAdded: false });
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
    expect(await controller.create('admin', body)).toEqual({ id: 'new-ku', isNew: true, noteAdded: false });
    expect(kus.create).toHaveBeenCalledWith({ type: 'Grammar', content: '〜ので', data: { meaning: 'because' } });
  });

  it("stores an admin's corpus note on an existing word, and nothing else", async () => {
    const { controller, kus } = setup({ existing: { id: 'ku1', data: { reading: 'いちにち' } }, admin: true });
    const body = { type: 'Vocab', content: '一日', data: { reading: 'ついたち', corpusNotes: ' いちにち reading only ' } };
    expect(await controller.create('admin', body)).toEqual({ id: 'ku1', isNew: false, noteAdded: true });
    expect(kus.update).toHaveBeenCalledWith('ku1', { 'data.corpusNotes': 'いちにち reading only' });
  });

  it('adds the note after one already stored, and skips a note that is already there', async () => {
    const { controller, kus } = setup({ existing: { id: 'ku1', data: { corpusNotes: 'いちにち reading only' } }, admin: true });
    await controller.create('admin', { type: 'Vocab', content: '一日', data: { corpusNotes: 'counter sense too' } });
    expect(kus.update).toHaveBeenCalledWith('ku1', { 'data.corpusNotes': 'いちにち reading only\ncounter sense too' });
    kus.update.mockClear();
    expect(await controller.create('admin', { type: 'Vocab', content: '一日', data: { corpusNotes: 'いちにち reading only' } }))
      .toEqual({ id: 'ku1', isNew: false, noteAdded: false });
    expect(kus.update).not.toHaveBeenCalled();
  });

  it("ignores a learner's corpus note on an existing word", async () => {
    const { controller, kus } = setup({ existing: { id: 'ku1' }, admin: false });
    const body = { type: 'Vocab', content: '一日', data: { corpusNotes: 'note' } };
    expect(await controller.create('learner', body)).toEqual({ id: 'ku1', isNew: false, noteAdded: false });
    expect(kus.update).not.toHaveBeenCalled();
  });
});
