import { Global, Module } from '@nestjs/common';
import { FacetStore } from './facet-store';

@Global()
@Module({
  providers: [FacetStore],
  exports: [FacetStore],
})
export class FacetsModule {}
