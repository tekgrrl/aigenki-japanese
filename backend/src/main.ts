import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { devAuthBypass } from './auth/firebase-auth.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  if (devAuthBypass()) new Logger('Auth').warn('DEV_AUTH_BYPASS is on: requests without a token are let in');
  await app.listen(process.env.PORT ?? 3500);
}
bootstrap();
