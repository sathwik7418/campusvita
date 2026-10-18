"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Check } from "lucide-react";

interface DownloadButtonProps {
  onDownload: () => void;
  downloading?: boolean;
}

export function DownloadButton({
  onDownload,
  downloading = false,
}: DownloadButtonProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  const isBusy = downloading || isAnimating;

  const handleDownloadClick = () => {
    if (isBusy) return;

    setIsAnimating(true);

    try {
      onDownload();
    } finally {
      window.setTimeout(() => {
        setIsAnimating(false);
      }, 1200);
    }
  };

  return (
    <div className="flex items-center justify-center">
      <motion.button
        type="button"
        onClick={handleDownloadClick}
        disabled={isBusy}
        aria-label={isBusy ? "Generating invoice" : "Download invoice"}
        title="Download Invoice"
        animate={{
          width: isBusy ? 42 : 174,
        }}
        transition={{
          duration: 0.3,
          ease: "easeInOut",
        }}
        className={[
          "relative inline-flex h-[42px] shrink-0 items-center overflow-hidden",
          "rounded-full border border-[var(--border)] bg-[var(--surface)]",
          "text-[var(--text-primary)] shadow-sm",
          "transition-colors hover:bg-[var(--primary-soft)]",
          "focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2",
          "disabled:cursor-wait",
        ].join(" ")}
      >
        {/* Animated download icon */}
        <motion.span
          animate={{
            rotate: isBusy ? 180 : 0,
          }}
          transition={{
            duration: 0.35,
            ease: "easeInOut",
          }}
          className={[
            "absolute left-0 top-0 z-10 flex h-10 w-10",
            "items-center justify-center rounded-full",
            "text-[var(--primary)]",
          ].join(" ")}
        >
          <AnimatePresence mode="wait" initial={false}>
            {isBusy ? (
              <motion.span
                key="loading"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
              >
                <span className="block h-[17px] w-[17px] animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--primary)]" />
              </motion.span>
            ) : (
              <motion.span
                key="download"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
              >
                <Download size={16} strokeWidth={2} />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.span>

        {/* Button label */}
        <AnimatePresence initial={false}>
          {!isBusy && (
            <motion.span
              key="label"
              initial={{ opacity: 0, x: 5 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 5 }}
              transition={{ duration: 0.2 }}
              className="ml-[39px] mr-4 whitespace-nowrap text-[13px] font-semibold"
            >
              Download Invoice
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}