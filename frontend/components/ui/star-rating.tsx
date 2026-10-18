"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  totalStars?: number;
  defaultValue?: number;
  onRate?: (rating: number) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
  readOnly?: boolean;
  showValue?: boolean;
}

export function StarRating({
  totalStars = 5,
  defaultValue = 0,
  onRate,
  size = "md",
  className,
  disabled = false,
  readOnly = false,
  showValue = false,
}: StarRatingProps) {
  const safeTotalStars =
    Number.isFinite(totalStars) && totalStars > 0
      ? Math.floor(totalStars)
      : 5;

  const normalizeRating = (value: number) => {
    if (!Number.isFinite(value)) return 0;

    return Math.min(
      safeTotalStars,
      Math.max(0, value)
    );
  };

  const [rating, setRating] = useState(() =>
    normalizeRating(defaultValue)
  );
  const [hover, setHover] = useState(0);

  // Keep the displayed rating synchronized with the parent's value.
  useEffect(() => {
    setRating(normalizeRating(defaultValue));
  }, [defaultValue, safeTotalStars]);

  const starSizes = {
    sm: "h-3.5 w-3.5",
    md: "h-5 w-5",
    lg: "h-7 w-7",
  };

  const handleRating = (star: number) => {
    if (disabled || readOnly) return;

    setRating(star);
    onRate?.(star);
  };

  const activeRating = hover || rating;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5",
        disabled && "opacity-50",
        className
      )}
      role="group"
      aria-label={`Rating: ${rating.toFixed(1)} out of ${safeTotalStars} stars`}
      onMouseLeave={() => setHover(0)}
    >
      <div className="flex items-center gap-0.5">
        {Array.from(
          { length: safeTotalStars },
          (_, index) => index + 1
        ).map((star) => (
          <motion.button
            key={star}
            type="button"
            tabIndex={readOnly || disabled ? -1 : 0}
            aria-label={`Rate ${star} out of ${safeTotalStars} stars`}
            aria-pressed={rating === star}
            disabled={disabled || readOnly}
            onClick={() => handleRating(star)}
            onMouseEnter={() => {
              if (!disabled && !readOnly) {
                setHover(star);
              }
            }}
            whileHover={
              !disabled && !readOnly
                ? { scale: 1.15 }
                : undefined
            }
            whileTap={
              !disabled && !readOnly
                ? { scale: 0.95 }
                : undefined
            }
            className={cn(
              "rounded-sm focus-visible:outline-none focus-visible:ring-2",
              "focus-visible:ring-amber-400 focus-visible:ring-offset-2",
              "focus-visible:ring-offset-[var(--surface)]",
              (disabled || readOnly)
                ? "cursor-default"
                : "cursor-pointer"
            )}
          >
            <Star
              className={cn(
                starSizes[size],
                "transition-colors duration-200",
                activeRating >= star
                  ? "fill-amber-400 text-amber-400"
                  : "fill-transparent text-gray-400 dark:text-gray-500"
              )}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </motion.button>
        ))}
      </div>

      {showValue && (
        <span className="text-xs font-semibold tabular-nums text-[var(--text-primary)]">
          {rating.toFixed(1)}
        </span>
      )}
    </div>
  );
}