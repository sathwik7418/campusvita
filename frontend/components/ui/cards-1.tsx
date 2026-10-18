"use client";

import React from "react";
import Link from "next/link";
import { Bookmark, Clock, Star } from "lucide-react";

export interface StallCardProps {
  _id: string;
  name: string;
  image?: string;
  description?: string;
  cuisine?: string;
  rating?: number | string | null;
  preparationTime?: string | number;
  priceMin?: number;
  priceMax?: number;
  isOpen?: boolean;
}

export default function StallCard({
  _id,
  name,
  image,
  description,
  cuisine,
  rating,
  preparationTime,
  priceMin,
  priceMax,
  isOpen,
}: StallCardProps) {
  // Normalize ratings received from the API.
  // Accept numbers and numeric strings, but reject missing or invalid values.
  const numericRating =
    typeof rating === "number" ||
    (typeof rating === "string" && rating.trim() !== "")
      ? Number(rating)
      : null;

  const hasValidRating =
    numericRating !== null &&
    Number.isFinite(numericRating) &&
    numericRating >= 1 &&
    numericRating <= 5;

  const formattedRating = hasValidRating
    ? numericRating.toFixed(1)
    : null;

  const priceText = () => {
    const min =
      typeof priceMin === "number" && Number.isFinite(priceMin)
        ? priceMin
        : null;
    const max =
      typeof priceMax === "number" && Number.isFinite(priceMax)
        ? priceMax
        : null;

    if (min !== null && max !== null && min !== max) {
      return `₹${min}–₹${max}`;
    }
    if (min !== null) return `₹${min}`;
    if (max !== null) return `₹${max}`;
    return "Price varies";
  };

  const fallbackImage = "/images/tiles/biryani.jpg";

  return (
    <Link
      href={`/stall/${_id}`}
      className="cv-glass-card cv-lift group block overflow-hidden rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
    >
      {/* Stall image */}
      <div className="relative aspect-[16/10] overflow-hidden bg-[var(--surface-secondary)]">
        <img
          src={image || fallbackImage}
          alt={name}
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.onerror = null;
            event.currentTarget.src = fallbackImage;
          }}
        />

        {/* Bookmark button */}
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          aria-label={`Bookmark ${name}`}
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] shadow-md transition-colors hover:bg-[var(--surface-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] motion-reduce:transition-none"
        >
          <Bookmark size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* Stall information */}
      <div className="p-5">
        <h3 className="line-clamp-1 text-base font-bold leading-snug tracking-[-0.02em] text-[var(--text-primary)]">
          {name}
        </h3>

        {/* Description */}
        {description && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">
            {description}
          </p>
        )}

        {/* Cuisine */}
        {cuisine && (
          <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            {cuisine}
          </p>
        )}

        {/* Divider */}
        <div className="mt-3 border-t border-[var(--border)]" />

        {/* Preparation time and pricing */}
        <div className="mt-3 flex min-h-7 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
            <Clock
              size={13}
              strokeWidth={2}
              className="shrink-0"
              aria-hidden="true"
            />
            <span className="truncate">
              {preparationTime !== undefined &&
              preparationTime !== null &&
              String(preparationTime).trim() !== ""
                ? `${preparationTime} min`
                : "Prep time —"}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="cv-tnum text-sm font-semibold tracking-tight text-[var(--text-primary)]">
              {priceText()}
            </span>

            {hasValidRating && formattedRating !== null && (
              <span
                aria-label={`Rated ${formattedRating} out of 5`}
                title={`Rating: ${formattedRating} out of 5`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#267E3E] px-2.5 py-1.5 text-[12px] font-bold leading-none tracking-tight tabular-nums text-white shadow-sm transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transition-none"
              >
                <span
                  className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-white"
                  aria-hidden="true"
                >
                  <Star
                    size={11}
                    className="fill-[#267E3E] text-[#267E3E]"
                    strokeWidth={2.5}
                  />
                </span>
                <span>{formattedRating}</span>
              </span>
            )}
          </div>
        </div>

        {/* Availability status */}
        <div className="mt-3 flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              isOpen
                ? "bg-[var(--success)]"
                : "bg-[var(--text-subtle)]"
            }`}
          />
          <span
            className={`text-[10px] font-semibold uppercase tracking-wider ${
              isOpen
                ? "text-[var(--success)]"
                : "text-[var(--text-muted)]"
            }`}
          >
            {isOpen ? "Open now" : "Closed"}
          </span>
        </div>
      </div>
    </Link>
  );
}