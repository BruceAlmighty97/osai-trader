import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Log everything — see "Coding Guidelines — Logging" in CLAUDE.md.
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const config = new DocumentBuilder()
    .setTitle('tastytrade-service')
    .setDescription('Automated options strategy trader on tastytrade')
    .setVersion('0.1.0')
    // Enables the "Authorize" button; sends the key as the X-API-Key header.
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'X-API-Key')
    .addSecurityRequirements('X-API-Key')
    .build();
  SwaggerModule.setup('swagger', app, SwaggerModule.createDocument(app, config));

  await app.listen(process.env.PORT ?? 3100);
}
bootstrap();
