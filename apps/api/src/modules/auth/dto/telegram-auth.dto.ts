import { IsString, MinLength } from 'class-validator';

export class TelegramAuthDto {
  /** Raw `window.Telegram.WebApp.initData` string from the Mini App. */
  @IsString()
  @MinLength(1)
  initData!: string;
}
