import { Global, Module } from '@nestjs/common';
import { KnowledgeUnitsController } from './knowledge-units.controller';
import { KnowledgeUnitsService } from './knowledge-units.service';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [KnowledgeUnitsController],
  providers: [KnowledgeUnitsService],
  exports: [KnowledgeUnitsService],
})
export class KnowledgeUnitsModule {}
