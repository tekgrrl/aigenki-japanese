import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from './admin.guard';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { ApilogController } from '../apilog/apilog.controller';
import { AudioController } from '../audio/audio.controller';
import { KnowledgeUnitsController } from '../knowledge-units/knowledge-units.controller';

/** The guards declared on a controller class, or on one of its route handlers. */
const guardsOn = (target: object) => (Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as unknown[];

describe('route guards (security sweep)', () => {
  it('the API log viewer and Prompt Tester are admin-only', () => {
    expect(guardsOn(ApilogController)).toContain(AdminGuard);
  });

  it('text-to-speech needs a signed-in user', () => {
    expect(guardsOn(AudioController.prototype.speak)).toContain(FirebaseAuthGuard);
  });

  it.each(['update', 'bulkUpdate', 'bulkIngest', 'remove'] as const)(
    'global word write %s is admin-only',
    handler => {
      expect(guardsOn(KnowledgeUnitsController.prototype[handler])).toContain(AdminGuard);
    },
  );
});
