import { useEffect, useRef, useState } from "react";

interface VideoTeaserProps {
  thumbnailSrc: string;
  thumbnailAlt: string;
  videoId: string;
}

export default function VideoTeaser({ thumbnailSrc, thumbnailAlt, videoId }: VideoTeaserProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setIsOpen(true);
        }}
        aria-label="Watch the 3-minute demo video"
        className="border-border bg-card group focus-visible:ring-primary relative block aspect-video w-full overflow-hidden rounded-xl border shadow-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        <img src={thumbnailSrc} alt={thumbnailAlt} className="h-full w-full object-cover" loading="lazy" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/20">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/40 bg-white/20 shadow-lg backdrop-blur-md transition-transform duration-200 group-hover:scale-110 group-hover:shadow-xl sm:h-20 sm:w-20">
            <svg viewBox="0 0 24 24" className="h-6 w-6 translate-x-0.5 fill-white sm:h-7 sm:w-7" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
        <span className="absolute bottom-3 left-3 rounded-md bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm sm:bottom-4 sm:left-4 sm:text-sm">
          ▶ Watch 3-min demo
        </span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Demo video"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close video"
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/40 bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
              <path d="M6.4 4.98 4.98 6.4 10.58 12l-5.6 5.6 1.42 1.42L12 13.42l5.6 5.6 1.42-1.42L13.42 12l5.6-5.6-1.42-1.42L12 10.58z" />
            </svg>
          </button>
          <div className="aspect-video w-full max-w-5xl overflow-hidden rounded-xl shadow-2xl">
            <iframe
              className="h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
              title="Demo video"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}
    </>
  );
}
