import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { RealtimeService } from './realtime.service';
import { NotificationProcessor } from './notification.processor';
import { RealtimeController } from './realtime.controller';
import { QUEUE_NAMES } from '../queue/queue-names';

/**
 * Global so any domain module can announce an event without importing a
 * chain of modules (and without risking a dependency cycle back through
 * whatever module raised it).
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATIONS })],
  controllers: [RealtimeController],
  providers: [NotificationDispatcher, RealtimeService, NotificationProcessor],
  exports: [NotificationDispatcher, RealtimeService],
})
export class NotificationsModule {}
