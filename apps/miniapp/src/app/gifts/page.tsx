'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Gift, Loader2, Star } from 'lucide-react';
import { Button, Card, CardContent, Badge } from '@sqlm/ui';
import { useGifts, useMyRewards } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { api, ApiError } from '@/lib/api';
import type { GiftProduct } from '@/types/api';

export default function GiftsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const hasSession = useAuthStore((s) => Boolean(s.accessToken));
  const { data: gifts, isLoading } = useGifts();
  const { data: myRewards } = useMyRewards();

  const instantGifts = gifts?.filter((g) => g.giftType === 'INSTANT_FREE') ?? [];
  const socialGifts = gifts?.filter((g) => g.giftType === 'SOCIAL_REWARD') ?? [];

  return (
    <main className="flex flex-col gap-6 p-4" dir="rtl">
      <header>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Gift className="h-6 w-6 text-pink-500" />
          الهدايا المجانية
        </h1>
        <p className="text-sm text-muted-foreground mt-1">احصل على منتجات مجاناً بدون أي مقابل!</p>
      </header>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin h-8 w-8 text-muted-foreground" />
        </div>
      )}

      {!isLoading && gifts?.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Gift className="h-16 w-16 text-muted-foreground/40" />
          <p className="text-muted-foreground">مفيش هدايا متاحة دلوقتي</p>
          <p className="text-xs text-muted-foreground">تابعنا على التيليجرام علشان تعرف أول ما تنزل هدايا جديدة!</p>
        </div>
      )}

      {/* Instant free gifts */}
      {instantGifts.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-1">
            🎁 هدايا فورية
            <span className="text-xs text-muted-foreground">— استلمها في الحال!</span>
          </h2>
          <div className="grid gap-3">
            {instantGifts.map((gift) => (
              <InstantGiftCard
                key={gift.id}
                gift={gift}
                hasSession={hasSession}
                onClaimed={() => {
                  void qc.invalidateQueries({ queryKey: ['gifts'] });
                  void qc.invalidateQueries({ queryKey: ['orders'] });
                  router.push('/orders');
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Social reward gifts */}
      {socialGifts.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-1">
            🌟 مكافآت التفاعل
            <span className="text-xs text-muted-foreground">— علّق أو قيّم وادّي هديتك!</span>
          </h2>
          <div className="grid gap-3">
            {socialGifts.map((gift) => (
              <SocialRewardCard key={gift.id} gift={gift} hasSession={hasSession} />
            ))}
          </div>
        </section>
      )}

      {/* My pending rewards */}
      {hasSession && myRewards && myRewards.length > 0 && (
        <section className="space-y-3 mt-4">
          <h2 className="font-semibold text-sm">طلبات المكافأة بتاعتك</h2>
          <div className="grid gap-2">
            {myRewards.map((r) => (
              <Card key={r.id} className="border border-border">
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{r.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.claimType === 'FACEBOOK_COMMENT' ? 'تعليق فيسبوك' : 'تقييم الصفحة'}
                    </p>
                  </div>
                  <StatusBadge status={r.status} reason={r.rejectionReason} />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function StatusBadge({ status, reason }: { status: string; reason: string | null }) {
  if (status === 'PENDING') return <Badge variant="secondary">⏳ قيد المراجعة</Badge>;
  if (status === 'APPROVED') return <Badge className="bg-green-500 text-white">✅ تمت الموافقة</Badge>;
  return (
    <div className="text-right">
      <Badge variant="destructive">❌ مرفوض</Badge>
      {reason && <p className="text-xs text-muted-foreground mt-1">{reason}</p>}
    </div>
  );
}

function InstantGiftCard({
  gift,
  hasSession,
  onClaimed,
}: {
  gift: GiftProduct;
  hasSession: boolean;
  onClaimed: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClaim = async () => {
    if (!hasSession) {
      setError('سجّل دخولك عبر تيليجرام أولاً.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.claimInstantGift(gift.id);
      onClaimed();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'حصل خطأ، حاول مرة أخرى');
    } finally {
      setLoading(false);
    }
  };

  const thumb = gift.images[0];

  return (
    <Card className={`overflow-hidden ${gift.isSoldOut ? 'opacity-60' : ''}`}>
      <CardContent className="p-0">
        <div className="flex gap-3 p-3">
          {thumb && (
            <img
              src={thumb}
              alt={gift.name}
              className="h-20 w-20 shrink-0 rounded-lg object-cover"
            />
          )}
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-sm leading-tight">{gift.name}</p>
              {gift.badge && (
                <Badge variant="outline" className="shrink-0 text-xs">{gift.badge}</Badge>
              )}
            </div>
            {gift.shortDescription && (
              <p className="text-xs text-muted-foreground line-clamp-2">{gift.shortDescription}</p>
            )}
            <div className="flex items-center justify-between mt-auto pt-1">
              <div className="flex flex-col">
                <span className="text-base font-bold text-green-600">مجاناً 🎁</span>
                {gift.remainingClaims !== null && !gift.isSoldOut && (
                  <span className="text-xs text-muted-foreground">متبقي: {gift.remainingClaims}</span>
                )}
                {gift.ratingScore && (
                  <span className="text-xs flex items-center gap-1 text-amber-500">
                    <Star className="h-3 w-3 fill-amber-400" />
                    {Number(gift.ratingScore).toFixed(1)} ({gift.reviewCount})
                  </span>
                )}
              </div>
              <Button
                size="sm"
                disabled={gift.isSoldOut || loading}
                onClick={() => void handleClaim()}
                className="shrink-0"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : gift.isSoldOut ? 'نفدت' : 'استلم'}
              </Button>
            </div>
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SocialRewardCard({ gift, hasSession }: { gift: GiftProduct; hasSession: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [claimType, setClaimType] = useState<'FACEBOOK_COMMENT' | 'FACEBOOK_RATING'>('FACEBOOK_COMMENT');
  const [postUrl, setPostUrl] = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);

  const thumb = gift.images[0];

  const handleUploadScreenshot = async (file: File) => {
    setUploadingScreenshot(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
      const { useAuthStore } = await import('@/store/auth-store');
      const token = useAuthStore.getState().accessToken;
      const res = await fetch(`${API_URL}/api/v1/storage/upload`, {
        method: 'POST',
        body: form,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('فشل رفع الصورة');
      const data = await res.json() as { url: string };
      setScreenshots((prev) => [...prev, data.url]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل رفع الصورة');
    } finally {
      setUploadingScreenshot(false);
    }
  };

  const handleSubmit = async () => {
    if (!hasSession) { setError('سجّل دخولك أولاً.'); return; }
    if (screenshots.length === 0) { setError('ارفع سكرين شوت إثبات أولاً.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api.submitSocialReward({
        productId: gift.id,
        claimType,
        facebookPostUrl: postUrl || undefined,
        facebookProfileUrl: profileUrl || undefined,
        proofScreenshots: screenshots,
      });
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'حصل خطأ، حاول مرة أخرى');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-4 text-center">
          <p className="font-medium text-green-700">✅ تم إرسال طلب المكافأة!</p>
          <p className="text-sm text-green-600 mt-1">هيتراجع خلال 24 ساعة وهتوصلك الهدية أول ما تتقبل.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex gap-3">
          {thumb && (
            <img src={thumb} alt={gift.name} className="h-20 w-20 shrink-0 rounded-lg object-cover" />
          )}
          <div className="flex flex-col gap-1 flex-1">
            <div className="flex items-start justify-between">
              <p className="font-semibold text-sm">{gift.name}</p>
              <Badge variant="secondary" className="text-xs shrink-0">تفاعل</Badge>
            </div>
            {gift.shortDescription && (
              <p className="text-xs text-muted-foreground line-clamp-2">{gift.shortDescription}</p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-2 self-start"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'إلغاء' : '🌟 احصل على المكافأة'}
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 flex flex-col gap-3 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              1. اعمل تعليق على البوست أو قيّم الصفحة
              <br />
              2. ارفع سكرين شوت إثبات
              <br />
              3. اضغط إرسال — هيوصلك الرد خلال 24 ساعة
            </p>

            {/* Quick links to the Facebook post / page */}
            {(gift.socialPostUrl || gift.socialPageUrl) && (
              <div className="flex gap-2">
                {gift.socialPostUrl && (
                  <a
                    href={gift.socialPostUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-lg border border-blue-200 bg-blue-50 py-2 text-center text-xs font-medium text-blue-700"
                  >
                    💬 افتح البوست
                  </a>
                )}
                {gift.socialPageUrl && (
                  <a
                    href={gift.socialPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-lg border border-blue-200 bg-blue-50 py-2 text-center text-xs font-medium text-blue-700"
                  >
                    ⭐ قيّم الصفحة
                  </a>
                )}
              </div>
            )}

            {/* Claim type selector */}
            <div className="flex gap-2">
              {(['FACEBOOK_COMMENT', 'FACEBOOK_RATING'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setClaimType(t)}
                  className={`flex-1 rounded-lg border py-2 text-xs font-medium transition ${
                    claimType === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                  }`}
                >
                  {t === 'FACEBOOK_COMMENT' ? '💬 تعليق' : '⭐ تقييم'}
                </button>
              ))}
            </div>

            <input
              type="url"
              placeholder="رابط البوست (اختياري)"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              dir="ltr"
            />
            <input
              type="url"
              placeholder="رابط بروفايلك (اختياري)"
              value={profileUrl}
              onChange={(e) => setProfileUrl(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              dir="ltr"
            />

            {/* Screenshots */}
            <div className="space-y-2">
              <p className="text-xs font-medium">سكرين شوت الإثبات:</p>
              <div className="flex flex-wrap gap-2">
                {screenshots.map((url, i) => (
                  <div key={i} className="relative">
                    <img src={url} alt="screenshot" className="h-16 w-16 rounded object-cover" />
                    <button
                      className="absolute -top-1 -right-1 rounded-full bg-destructive text-white text-xs h-4 w-4 flex items-center justify-center"
                      onClick={() => setScreenshots((p) => p.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded border-2 border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary/50">
                  {uploadingScreenshot ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <span className="text-2xl">+</span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadScreenshot(f);
                    }}
                  />
                </label>
              </div>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button
              disabled={submitting || screenshots.length === 0}
              onClick={() => void handleSubmit()}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              إرسال طلب المكافأة
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
