"use client";

import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { useState } from "react";

type HeartFavoriteProps = {
  foodName?: string;
};

export function HeartFavorite({
  foodName = "food item",
}: HeartFavoriteProps) {
  const [isLiked, setIsLiked] = useState(false);

  return (
    <motion.button
      type="button"
      onClick={() => setIsLiked((previous) => !previous)}
      whileTap={{ scale: 0.9 }}
      aria-label={
        isLiked
          ? `Remove ${foodName} from favourites`
          : `Add ${foodName} to favourites`
      }
      aria-pressed={isLiked}
      title={isLiked ? "Remove from favourites" : "Add to favourites"}
      className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/5 bg-white/95 text-gray-500 shadow-md backdrop-blur-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-white/10 dark:bg-gray-900/90 dark:hover:bg-gray-800"
    >
      <motion.span
        animate={{ scale: isLiked ? [1, 1.3, 1] : 1 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="flex items-center justify-center"
      >
        <Heart
          size={16}
          strokeWidth={2}
          className={`transition-colors duration-200 ${
            isLiked ? "fill-red-500 text-red-500" : "text-gray-500"
          }`}
          aria-hidden="true"
        />
      </motion.span>
    </motion.button>
  );
}
