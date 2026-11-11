import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { devAuthBypass } from './auth/firebase-auth.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  // With the dev bypass on, anyone who can reach the port is let in, so listen on this machine only.
  const bypass = devAuthBypass();
  if (bypass) new Logger('Auth').warn('DEV_AUTH_BYPASS is on: requests without a token are let in; listening on 127.0.0.1 only');
  const port = process.env.PORT ?? 3500;
  if (bypass) await app.listen(port, '127.0.0.1');
  else await app.listen(port);
}
bootstrap();
