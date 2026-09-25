import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';

@Controller({ version: VERSION_NEUTRAL })
export class AppController {
  @Get()
  info() {
    return {
      name: 'SQLM Digital Commerce API',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
