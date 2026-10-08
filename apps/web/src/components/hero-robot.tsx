import Image from 'next/image';

/**
 * The store's mascot, waving from the hero. Decorative — the headline and
 * the buttons beside it carry the message — so it is hidden from readers.
 */
export function HeroRobot() {
  return (
    <div
      aria-hidden
      className="relative mx-auto w-full max-w-[20rem] sm:max-w-[24rem] lg:max-w-[27rem]"
    >
      <div className="absolute inset-[6%] -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(var(--tg)/0.28),transparent)] blur-2xl" />
      <div className="absolute inset-x-[18%] bottom-[1%] -z-10 h-[6%] rounded-[100%] bg-ink/15 blur-md motion-safe:animate-[robot-shadow_6s_ease-in-out_infinite]" />
      <Image
        src="/robot.webp"
        alt=""
        width={880}
        height={840}
        priority
        sizes="(min-width: 1024px) 27rem, (min-width: 640px) 24rem, 20rem"
        className="h-auto w-full select-none motion-safe:animate-[robot-float_6s_ease-in-out_infinite]"
        draggable={false}
      />
    </div>
  );
}
