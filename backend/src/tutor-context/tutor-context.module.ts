import { Global, Module } from '@nestjs/common';
import { TutorContextService } from './tutor-context.service';

/** Global, like UserModule: the tutor context is updated from reviews, enrolment, flags and level sync. */
@Global()
@Module({
  providers: [TutorContextService],
  exports: [TutorContextService],
})
export class TutorContextModule {}
