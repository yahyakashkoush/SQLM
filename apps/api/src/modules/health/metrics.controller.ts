import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/** Version-neutral so the Prometheus scrape config never has to change. */
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  async scrape(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
