import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';

/** Registers ApiKeyGuard as a global guard (protects every controller route). */
@Module({
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AuthModule {}
