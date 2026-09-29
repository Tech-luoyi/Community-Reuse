'use client';

import { ImagePlus, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { uploadOne } from '@/lib/image';

const MAX = 6;

export function ImageUploader({
  keys,
  onChange,
}: {
  keys: string[];
  onChange: (k: string[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    if (keys.length + files.length > MAX) return toast.error(`最多 ${MAX} 张图`);
    setUploading(true);
    try {
      const done: string[] = [];
      for (const f of Array.from(files)) {
        const r = await uploadOne(f);
        done.push(r.key);
      }
      onChange([...keys, ...done]);
      toast.success(`已上传 ${done.length} 张`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {keys.map((k) => (
          <div
            key={k}
            className="group relative aspect-square overflow-hidden rounded-md bg-surface-sunken"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={k.startsWith('/') || k.startsWith('http') ? k : `/uploads/${k}`}
              alt=""
              className="size-full object-cover"
            />
            <button
              type="button"
              onClick={() => onChange(keys.filter((x) => x !== k))}
              aria-label="移除这张图"
              className="absolute right-1 top-1 grid size-6 place-items-center rounded-md bg-ink/70 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X size={13} />
            </button>
          </div>
        ))}

        {keys.length < MAX && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="grid aspect-square place-items-center rounded-md border border-dashed border-line-strong text-ink-tertiary transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <span className="flex flex-col items-center gap-1 text-[11px]">
                <ImagePlus size={18} />
                {keys.length}/{MAX}
              </span>
            )}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <p className="mt-2 text-[11px] leading-relaxed text-ink-tertiary">
        上传前在浏览器端压缩（长边 ≤ 1600px / WebP 0.8），服务端另做类型与体积校验。
      </p>
    </div>
  );
}
