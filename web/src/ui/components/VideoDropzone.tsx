import { useCallback, useRef, useState } from "react";
import { Upload, Film, X, Sparkles } from "lucide-react";

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
  accept?: string;
}

export function VideoDropzone({ onFile, disabled, accept = "video/*" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pickedName, setPickedName] = useState<string | null>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const f = files[0];
      if (!f) return;
      setPickedName(f.name);
      onFile(f);
    },
    [onFile],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-[20px] border-2 border-dashed px-6 py-14 text-center transition ${
        dragOver
          ? "border-[#B6FF3B] bg-[#B6FF3B]/10 shadow-[0_0_24px_rgba(182,255,59,0.2)]"
          : "border-[#27272A] bg-[#0A0A0A] hover:border-[#B6FF3B]/30 hover:bg-[#1A1A1A]"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled}
      />
      <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${dragOver ? "bg-[#B6FF3B] text-black" : "bg-[#1A1A1A] text-[#B6FF3B]"} shadow-[0_0_12px_rgba(182,255,59,0.15)]`}>
        <Film className="h-7 w-7" />
      </div>
      <p className="text-sm font-black text-white flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[#B6FF3B]" /> Drop video here, atau klik untuk pilih file
      </p>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#a1a1aa]">
        <Upload className="h-3.5 w-3.5" /> MP4 / MOV / MKV · max 2GB disarankan · auto 9:16
      </p>
      {pickedName && (
        <div className="mt-4 flex items-center gap-2 rounded-full bg-[#B6FF3B] text-black px-4 py-1.5 text-xs font-bold">
          <span className="max-w-[260px] truncate">{pickedName}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPickedName(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="rounded-full bg-black/10 p-1 hover:bg-black/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {dragOver && <div className="pointer-events-none absolute inset-0 rounded-[20px] border-2 border-[#B6FF3B]" />}
    </div>
  );
}
