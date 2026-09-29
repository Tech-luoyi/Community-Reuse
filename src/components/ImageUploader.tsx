'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { uploadOne } from '@/lib/image';

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
    if (keys.length + files.length > 6) return toast.error('最多 6 张图');
    setUploading(true);
    try {
      const done: string[] = [];
      for (const f of Array.from(files)) {
        const r = await uploadOne(f);
        done.push(r.key);
      }
      onChange([...keys, ...done]);
      toast.success(`上传成功 ${done.length} 张（已前端压缩）`);
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
        <AnimatePresence>
          {keys.map((k) => (
            <motion.div
              key={k}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="group relative aspect-square overflow-hidden rounded-2xl bg-stone-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={k.startsWith('/') || k.startsWith('http') ? k : `/uploads/${k}`}
                alt=""
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => onChange(keys.filter((x) => x !== k))}
                className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {keys.length < 6 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="grid aspect-square place-items-center rounded-2xl border-2 border-dashed border-stone-300 text-stone-400 transition hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50/50"
          >
            {uploading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <span className="flex flex-col items-center gap-1 text-xs font-bold">
                <ImagePlus size={22} />
                上传 ({keys.length}/6)
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
      <p className="mt-1.5 text-[11px] leading-relaxed text-stone-400">
        前端 canvas 自动压缩（长边≤1600px / WebP 0.8），服务端独立校验类型与 5MB 上限。
      </p>
    </div>
  );
}
