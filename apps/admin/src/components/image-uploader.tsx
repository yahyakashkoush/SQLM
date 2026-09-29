'use client';

import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, X } from 'lucide-react';
import { Button } from '@sqlm/ui';
import { api, ApiError } from '@/lib/api';

/**
 * Uploads to the API's public image store and hands back URLs. `max={1}`
 * gives a single-image picker (category image, payment QR code); the
 * first image of a multi-image list is the product's cover.
 */
export function ImageUploader({
  value,
  onChange,
  max = 8,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState('');

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    const next = [...value];
    try {
      for (const file of Array.from(files).slice(0, max - value.length || 1)) {
        const { url } = await api.uploadImage(file);
        if (max === 1) next.splice(0, next.length, url);
        else next.push(url);
      }
      onChange(next.slice(0, max));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const move = (from: number, to: number) => {
    const next = [...value];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };

  const canAdd = max === 1 || value.length < max;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((url, i) => (
          <div key={url + i} className="group relative h-24 w-24 overflow-hidden rounded-md border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary storage hosts */}
            <img src={url} alt="" className="h-full w-full object-cover" />
            {i === 0 && max > 1 && (
              <span className="absolute left-1 top-1 rounded bg-primary px-1 text-[10px] text-primary-foreground">
                Cover
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-background/80 p-0.5 opacity-0 transition group-hover:opacity-100">
              <button type="button" disabled={i === 0} onClick={() => move(i, i - 1)} className="p-0.5 disabled:opacity-30" aria-label="Move left">
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="p-0.5 text-destructive" aria-label="Remove image">
                <X className="h-3.5 w-3.5" />
              </button>
              <button type="button" disabled={i === value.length - 1} onClick={() => move(i, i + 1)} className="p-0.5 disabled:opacity-30" aria-label="Move right">
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {canAdd && (
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-accent"
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            {uploading ? 'Uploading…' : max === 1 && value.length ? 'Replace' : 'Upload'}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple={max > 1}
        className="hidden"
        onChange={(e) => void upload(e.target.files)}
      />
      <div className="flex gap-2">
        <input
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          placeholder="…or paste an image URL"
          className="h-8 flex-1 rounded-md border bg-transparent px-2 text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!/^https?:\/\//.test(urlDraft.trim())}
          onClick={() => {
            onChange(max === 1 ? [urlDraft.trim()] : [...value, urlDraft.trim()].slice(0, max));
            setUrlDraft('');
          }}
        >
          Add URL
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
