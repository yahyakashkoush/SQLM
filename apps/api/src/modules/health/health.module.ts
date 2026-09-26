import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController, MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class HealthModule {}
