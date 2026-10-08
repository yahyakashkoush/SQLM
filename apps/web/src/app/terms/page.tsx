import type { Metadata } from 'next';
import { getSite } from '@/lib/api';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'الشروط والأحكام',
  description: 'شروط الشراء والدفع والتسليم والضمان في متجر subsc.',
};

type Block = { kind: 'heading'; text: string } | { kind: 'list'; items: string[] } | { kind: 'text'; text: string };

/**
 * The terms are one admin-edited text. Numbered lines ("١) ..." or "1) ...")
 * become headings and "•" lines become lists, so the page reads like a
 * document without the admin having to write any markup.
 */
function toBlocks(text: string): { title: string | null; blocks: Block[] } {
  const lines = text.split('\n').map((l) => l.trim());
  const firstContent = lines.findIndex(Boolean);
  const title = firstContent >= 0 && !/^[•\-]/.test(lines[firstContent]!) ? lines[firstContent]! : null;
  const blocks: Block[] = [];
  for (const line of lines.slice(title ? firstContent + 1 : 0)) {
    if (!line) continue;
    if (/^[•\-]\s*/.test(line)) {
      const item = line.replace(/^[•\-]\s*/, '');
      const last = blocks.at(-1);
      if (last?.kind === 'list') last.items.push(item);
      else blocks.push({ kind: 'list', items: [item] });
    } else if (/^[\d٠-٩]+[).]\s*/.test(line)) {
      blocks.push({ kind: 'heading', text: line });
    } else {
      blocks.push({ kind: 'text', text: line });
    }
  }
  return { title, blocks };
}

export default async function TermsPage() {
  const site = await getSite();
  const { title, blocks } = toBlocks(site.terms);

  return (
    <>
      <SiteHeader botUrl={site.botUrl} />
      <main className="site-container max-w-3xl py-12 sm:py-16">
        <p className="eyebrow">قانوني</p>
        <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">{title ?? 'الشروط والأحكام'}</h1>
        <div className="mt-10 space-y-5 text-[15px] leading-8">
          {blocks.length === 0 && <p className="text-ink-soft">الشروط بتتحدث حالياً — تقدر تشوفها في البوت بأمر /terms.</p>}
          {blocks.map((block, i) =>
            block.kind === 'heading' ? (
              <h2 key={i} className="pt-6 text-xl font-bold first:pt-0">
                {block.text}
              </h2>
            ) : block.kind === 'list' ? (
              <ul key={i} className="space-y-2 ps-1">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-3 text-ink-soft">
                    <span className="mt-[0.8em] h-1.5 w-1.5 shrink-0 rounded-full bg-tg" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p key={i} className="text-ink-soft">
                {block.text}
              </p>
            ),
          )}
        </div>
      </main>
      <SiteFooter botUrl={site.botUrl} supportContact={site.supportContact} />
    </>
  );
}
