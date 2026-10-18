"use client";

import { HeartFavorite } from "@/components/ui/heart-favorite-shadcnui";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useParams, useRouter } from "next/navigation";

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Filter,
  Leaf,
  List,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  Store,
  UtensilsCrossed,
  X,
} from "lucide-react";

import { getImageUrl } from "@/app/lib/getImageUrl";
import { useCart } from "@/context/CartContext";

/* ============================================================
   TYPES
============================================================ */

type Stall = {
  _id: string;
  name: string;
  image: string;
  description: string;
  is_open: boolean;
  active: boolean;
  rating: number | null;
  opening_time: string | null;
  closing_time: string | null;
  preparation_time: string | null;
};

type Food = {
  _id: string;
  name: string;
  price: number;
  category: string;
  category_id: string;
  stall_id: string;
  image: string;
  description: string;
  available: boolean;
  is_veg: boolean | null;
};

type StallFoodsResponse = {
  success: boolean;
  stall: Stall;
  foods: Food[];
  total: number;
};

type FoodType = "ALL" | "VEG" | "NON_VEG";

type SortOption =
  | "recommended"
  | "price-asc"
  | "price-desc"
  | "name-asc";

type FilterDraft = {
  category: string;
  foodType: FoodType;
  minPrice: string;
  maxPrice: string;
  availableOnly: boolean;
};

/* ============================================================
   HELPERS
============================================================ */

const formatPrice = (price: number) =>
  `₹${price.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;

const isValidPrice = (value: string) =>
  value.trim() === "" ||
  (Number.isFinite(Number(value)) &&
    Number(value) >= 0);

const formatRating = (rating: number) =>
  rating.toFixed(1);

const sortLabels: Record<SortOption, string> = {
  recommended: "Recommended",
  "price-asc": "Price: Low to High",
  "price-desc": "Price: High to Low",
  "name-asc": "Name: A to Z",
};

/* ============================================================
   STALL PAGE
============================================================ */

export default function StallPage() {
  const params = useParams();
  const router = useRouter();

  const stallId = String(params?.stallId ?? "");

  const {
    cartItems,
    addToCart,
    increaseQuantity,
    decreaseQuantity,
  } = useCart();

  /* ----------------------------------------------------------
     DATA
  ---------------------------------------------------------- */

  const [data, setData] =
    useState<StallFoodsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* ----------------------------------------------------------
     SEARCH AND FILTERS
  ---------------------------------------------------------- */

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] =
    useState("ALL");

  const [foodType, setFoodType] =
    useState<FoodType>("ALL");

  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const [availableOnly, setAvailableOnly] =
    useState(false);

  const [sortBy, setSortBy] =
    useState<SortOption>("recommended");

  /* ----------------------------------------------------------
     MOBILE SHEETS
  ---------------------------------------------------------- */

  const [activeSheet, setActiveSheet] = useState<
    "filter" | "sort" | null
  >(null);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [pendingCategoryIndex, setPendingCategoryIndex] =
    useState<number | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const [draftFilters, setDraftFilters] =
    useState<FilterDraft>({
      category: "ALL",
      foodType: "ALL",
      minPrice: "",
      maxPrice: "",
      availableOnly: false,
    });

  /* ----------------------------------------------------------
     IMAGE FALLBACK
  ---------------------------------------------------------- */

  const [heroImageFailed, setHeroImageFailed] =
    useState(false);

  /* ==========================================================
     LOAD STALL
  ========================================================== */

  useEffect(() => {
    if (!stallId) {
      setLoading(false);
      setError("Invalid stall.");
      return;
    }

    const controller = new AbortController();

    async function loadStall() {
      try {
        setLoading(true);
        setError("");

        const API_URL =
          process.env.NEXT_PUBLIC_API_URL ||
          "http://127.0.0.1:8000";

        const response = await fetch(
          `${API_URL}/stalls/${encodeURIComponent(
            stallId
          )}/foods`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
            cache: "no-store",
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(
            `Failed to load stall (${response.status})`
          );
        }

        const result: StallFoodsResponse =
          await response.json();

        if (
          !result ||
          !result.success ||
          !result.stall
        ) {
          throw new Error("Invalid stall response.");
        }

        setData({
          ...result,
          foods: Array.isArray(result.foods)
            ? result.foods
            : [],
          total:
            typeof result.total === "number"
              ? result.total
              : Array.isArray(result.foods)
                ? result.foods.length
                : 0,
        });
      } catch (err) {
        if (
          err instanceof DOMException &&
          err.name === "AbortError"
        ) {
          return;
        }

        console.error(
          "Failed to load stall:",
          err
        );

        setError("Unable to load this stall.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadStall();

    return () => controller.abort();
  }, [stallId]);

  /* ==========================================================
     RESET IMAGE STATE WHEN STALL CHANGES
  ========================================================== */

  useEffect(() => {
    setHeroImageFailed(false);
  }, [stallId]);

  /* ==========================================================
     CATEGORIES
  ========================================================== */

  const categories = useMemo(() => {
    if (!data) return [];

    return Array.from(
      new Set(
        data.foods
          .map((food) =>
            typeof food.category === "string"
              ? food.category.trim()
              : ""
          )
          .filter(Boolean)
      )
    );
  }, [data]);

  /* ==========================================================
     FILTERED FOOD
  ========================================================== */

  const filteredFoods = useMemo(() => {
    if (!data) return [];

    const normalizedSearch =
      search.trim().toLowerCase();

    const parsedMinPrice =
      minPrice.trim() === ""
        ? null
        : Number(minPrice);

    const parsedMaxPrice =
      maxPrice.trim() === ""
        ? null
        : Number(maxPrice);

    const filtered = data.foods.filter((food) => {
      const name = food.name || "";

      const description =
        food.description || "";

      const category = food.category || "";

      const matchesSearch =
        !normalizedSearch ||
        name.toLowerCase().includes(normalizedSearch) ||
        description
          .toLowerCase()
          .includes(normalizedSearch) ||
        category.toLowerCase().includes(normalizedSearch);

      const matchesCategory =
        selectedCategory === "ALL" ||
        category.trim() === selectedCategory;

      const matchesFoodType =
        foodType === "ALL" ||
        (foodType === "VEG" &&
          food.is_veg === true) ||
        (foodType === "NON_VEG" &&
          food.is_veg === false);

      const price =
        Number.isFinite(food.price) &&
        typeof food.price === "number"
          ? food.price
          : null;

      const matchesMinPrice =
        parsedMinPrice === null ||
        (price !== null &&
          price >= parsedMinPrice);

      const matchesMaxPrice =
        parsedMaxPrice === null ||
        (price !== null &&
          price <= parsedMaxPrice);

      const matchesAvailability =
        !availableOnly ||
        food.available === true;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesFoodType &&
        matchesMinPrice &&
        matchesMaxPrice &&
        matchesAvailability
      );
    });

    if (sortBy === "recommended") {
      return filtered;
    }

    return [...filtered].sort((a, b) => {
      if (
        sortBy === "price-asc" ||
        sortBy === "price-desc"
      ) {
        const priceA = Number.isFinite(a.price)
          ? a.price
          : null;

        const priceB = Number.isFinite(b.price)
          ? b.price
          : null;

        if (priceA === null && priceB === null) {
          return 0;
        }

        if (priceA === null) return 1;
        if (priceB === null) return -1;

        return sortBy === "price-asc"
          ? priceA - priceB
          : priceB - priceA;
      }

      return a.name.localeCompare(
        b.name,
        undefined,
        {
          sensitivity: "base",
          numeric: true,
        }
      );
    });
  }, [
    data,
    search,
    selectedCategory,
    foodType,
    minPrice,
    maxPrice,
    availableOnly,
    sortBy,
  ]);

  const categorySections = useMemo(
    () =>
      categories
        .map((category, index) => ({
          category,
          index,
          foods: filteredFoods.filter(
            (food) =>
              (food.category || "").trim() === category
          ),
        }))
        .filter((section) => section.foods.length > 0),
    [categories, filteredFoods]
  );

  const uncategorizedFoods = useMemo(
    () =>
      filteredFoods.filter(
        (food) => !(food.category || "").trim()
      ),
    [filteredFoods]
  );

  /* ==========================================================
     MENU PANEL ACCESSIBILITY AND CATEGORY SCROLLING
  ========================================================== */

  useEffect(() => {
    if (!isMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (pendingCategoryIndex === null) return;

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(
        `stall-category-${pendingCategoryIndex}`
      );

      if (target) {
        target.scrollIntoView({
          behavior: window.matchMedia(
            "(prefers-reduced-motion: reduce)"
          ).matches
            ? "auto"
            : "smooth",
          block: "start",
        });
      }

      setPendingCategoryIndex(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [pendingCategoryIndex, filteredFoods]);

  const navigateToCategory = (category: string, index: number) => {
    // Make sure the selected category remains reachable even when
    // the user had an active search, diet, price, or availability filter.
    setSearch("");
    setFoodType("ALL");
    setMinPrice("");
    setMaxPrice("");
    setAvailableOnly(false);
    setSelectedCategory(category);
    setActiveSheet(null);
    setIsMenuOpen(false);
    setPendingCategoryIndex(index);
  };

  /* ==========================================================
     CART
  ========================================================== */

  const getQuantity = useCallback(
    (foodName: string, foodStallId: string) => {
      return (
        cartItems.find(
          (item) =>
            item.name === foodName &&
            item.stall_id === foodStallId
        )?.quantity ?? 0
      );
    },
    [cartItems]
  );

  const handleAddToCart = (food: Food) => {
    if (
      !food.available ||
      !data?.stall.is_open
    ) {
      return;
    }

    addToCart({
      name: food.name,
      price: food.price,
      image: food.image,
      stall_id: food.stall_id,
    });
  };

  const handleIncreaseQuantity = (
    food: Food
  ) => {
    if (
      !food.available ||
      !data?.stall.is_open
    ) {
      return;
    }

    increaseQuantity(
      food.name,
      food.stall_id
    );
  };

  const handleDecreaseQuantity = (
    food: Food
  ) => {
    decreaseQuantity(
      food.name,
      food.stall_id
    );
  };

  const cartItemCount = useMemo(
    () =>
      cartItems.reduce(
        (total, item) =>
          total + Number(item.quantity || 0),
        0
      ),
    [cartItems]
  );

  const cartTotal = useMemo(
    () =>
      cartItems.reduce(
        (total, item) =>
          total +
          Number(item.price || 0) *
            Number(item.quantity || 0),
        0
      ),
    [cartItems]
  );

  const cartLabel =
    cartItemCount === 1 ? "item" : "items";

  /* ==========================================================
     FILTER HELPERS
  ========================================================== */

  const hasActiveFilters =
    search.trim().length > 0 ||
    selectedCategory !== "ALL" ||
    foodType !== "ALL" ||
    minPrice.trim() !== "" ||
    maxPrice.trim() !== "" ||
    availableOnly;

  const hasFilters =
    hasActiveFilters ||
    sortBy !== "recommended";

  const clearFilters = () => {
    setSearch("");
    setSelectedCategory("ALL");
    setFoodType("ALL");
    setMinPrice("");
    setMaxPrice("");
    setAvailableOnly(false);
    setSortBy("recommended");
    setActiveSheet(null);
  };

  const openFilterSheet = () => {
    setDraftFilters({
      category: selectedCategory,
      foodType,
      minPrice,
      maxPrice,
      availableOnly,
    });

    setActiveSheet("filter");
  };

  const applyFilters = () => {
    setSelectedCategory(draftFilters.category);
    setFoodType(draftFilters.foodType);
    setMinPrice(draftFilters.minPrice);
    setMaxPrice(draftFilters.maxPrice);
    setAvailableOnly(draftFilters.availableOnly);

    setActiveSheet(null);
  };

  const invalidDraftPrice =
    !isValidPrice(draftFilters.minPrice) ||
    !isValidPrice(draftFilters.maxPrice) ||
    (draftFilters.minPrice.trim() !== "" &&
      draftFilters.maxPrice.trim() !== "" &&
      Number(draftFilters.minPrice) >
        Number(draftFilters.maxPrice));

  /* ==========================================================
     LOADING
  ========================================================== */

  if (loading) {
    return <StallPageSkeleton />;
  }

  /* ==========================================================
     ERROR
  ========================================================== */

  if (error || !data) {
    return (
      <main className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--text-primary)] sm:px-6">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)] transition hover:text-[var(--brand)]"
          >
            <ArrowLeft size={17} />
            Back to stalls
          </button>

          <div className="mt-12 rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--surface-secondary)]">
              <Store
                size={28}
                className="text-[var(--text-muted)]"
              />
            </div>

            <h1 className="mt-5 text-xl font-bold">
              Unable to load this stall
            </h1>

            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              {error ||
                "The requested stall could not be found."}
            </p>

            <button
              type="button"
              onClick={() => router.back()}
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--brand)] px-5 text-sm font-bold text-white transition hover:bg-[var(--brand-hover)]"
            >
              <ArrowLeft size={16} />
              Return to stalls
            </button>
          </div>
        </div>
      </main>
    );
  }

  const stall = data.stall;

  /* ==========================================================
     MAIN PAGE
  ========================================================== */

  return (
    <main className="min-h-screen overflow-x-clip bg-[var(--background)] pb-28 text-[var(--text-primary)]">

      {/* ======================================================
          STALL COVER
      ====================================================== */}

      <section className="relative">
        <div className="relative h-[250px] overflow-hidden sm:h-[330px] lg:h-[390px]">
        {!heroImageFailed &&
(stall.name.toLowerCase().includes("fresh juice") ||
stall.name.toLowerCase().includes("fruit juice")) ? (
  <img
    src="/images/fresh-juice-pineapple-banner.jpg"
    alt="Fresh pineapple juice — Taste the fruit. Feel the Freshness."
    className="h-full w-full object-cover object-center transition-transform duration-700 hover:scale-[1.025]"
  />
) : !heroImageFailed && stall.image ? (
  <img
    src={getImageUrl(stall.image)}
    alt={stall.name}
    onError={() => setHeroImageFailed(true)}
    className="h-full w-full object-cover object-center transition-transform duration-700 hover:scale-[1.025]"
  />
) : (
            <div className="flex h-full w-full items-center justify-center bg-[var(--surface-secondary)]">
              <Store
                size={54}
                strokeWidth={1.4}
                className="text-[var(--text-muted)]"
              />
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/80" />

          {/* TOP ACTIONS */}

          <div className="absolute inset-x-0 top-0 mx-auto flex max-w-7xl items-center justify-between px-4 pt-5 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Go back"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60"
            >
              <ArrowLeft size={19} />
            </button>

            <div className="flex items-center gap-2">
              <span className="rounded-full bg-black/40 px-3 py-2 text-xs font-medium text-white backdrop-blur-md">
                CampusVita
              </span>
            </div>
          </div>

          {/* STALL TITLE */}

          <div className="absolute inset-x-0 bottom-0 mx-auto max-w-7xl px-4 pb-6 sm:px-6 sm:pb-8 lg:px-8">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold backdrop-blur-md ${
                  stall.is_open
                    ? "bg-emerald-500/95 text-white"
                    : "bg-red-500/95 text-white"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white" />

                {stall.is_open ? "Open now" : "Closed"}
              </span>

              {stall.rating !== null &&
                Number.isFinite(stall.rating) &&
                stall.rating >= 1 &&
                stall.rating <= 5 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/45 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur-md">
                    <Star
                      size={12}
                      fill="currentColor"
                      className="text-amber-400"
                    />
                    <span className="cv-tnum">{formatRating(stall.rating)}</span>
                  </span>
                )}
            </div>

            <h1 className="mt-3 max-w-4xl text-[clamp(1.9rem,4.6vw,3.4rem)] font-bold leading-[1.04] tracking-[-0.035em] text-white">
              {stall.name}
            </h1>

            {stall.description && (
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80 sm:text-base">
                {stall.description}
              </p>
            )}
          </div>
        </div>

        {/* ==================================================
            STALL DETAILS
        ================================================== */}

        <div className="relative z-10 mx-auto -mt-1 max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)]">
            <StallMeta
              icon={
                <CheckCircle2 size={17} />
              }
              label="Availability"
              value={
                stall.is_open
                  ? "Accepting orders"
                  : "Currently closed"
              }
              positive={stall.is_open}
            />

            <StallMeta
              icon={<Clock3 size={17} />}
              label="Preparation time"
              value={
                stall.preparation_time ||
                "Not specified"
              }
            />
          </div>
        </div>
      </section>

      {/* ======================================================
          MENU AND STICKY SEARCH
      ====================================================== */}

      <section className="mx-auto max-w-7xl px-4 pt-7 sm:px-6 sm:pt-9 lg:px-8">

        {/* SECTION HEADING */}

        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <UtensilsCrossed
                size={19}
                className="text-[var(--brand)]"
              />

              <h2 className="text-2xl font-bold tracking-[-0.03em] text-[var(--text-primary)] sm:text-3xl">
                Explore the menu
              </h2>
            </div>

            <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
              Fresh choices, just for you.
            </p>
          </div>

          <span className="shrink-0 rounded-full bg-[var(--surface-secondary)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)]">
            {data.total} dishes
          </span>
        </div>

        {/* ==================================================
            STICKY SEARCH
        ================================================== */}

        <div className="sticky top-0 z-30 -mx-4 mt-5 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 pb-3 pt-3 backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-0">
          <div className="relative">
            <Search
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />

            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search dishes..."
              aria-label="Search dishes"
              className="h-12 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] pl-11 pr-11 text-sm font-medium outline-none transition placeholder:text-[var(--text-muted)] hover:border-[var(--border-strong)] focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/10 sm:h-12"
            />

            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-[var(--text-muted)] transition hover:bg-[var(--surface-secondary)]"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* FILTER + SORT + DIETARY PREFERENCE */}

<div className="mt-3 grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 pb-1 sm:flex sm:flex-nowrap sm:gap-2">

{/* FILTER BUTTON */}

<button
  type="button"
  onClick={openFilterSheet}
  className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-bold transition sm:px-3 ${
    hasActiveFilters
      ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)]"
  }`}
>
  <SlidersHorizontal size={14} />
  <span>Filters</span>

  {hasActiveFilters && (
    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[9px] text-white">
      !
    </span>
  )}
</button>

{/* SORT BUTTON */}

<button
  type="button"
  onClick={() => setActiveSheet("sort")}
  className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-bold text-[var(--text-primary)] transition sm:gap-1.5 sm:px-3"
>
  <ArrowUpDown size={14} />
  <span>Sort By</span>
  <ChevronDown size={13} />
</button>

{/* RESPONSIVE VEG / NON-VEG TOGGLE */}

<div
  className="
    relative grid h-10 w-full min-w-0
    grid-cols-2 items-center gap-1
    rounded-full border border-[#e5e7eb]
    bg-[#f3f4f6] p-1 shadow-sm
    dark:border-[#454b58]
    dark:bg-[#252a34]
    sm:ml-1 sm:h-10 sm:w-[190px] sm:shrink-0
  "
  role="group"
  aria-label="Dietary preference"
>
  {/* ANIMATED SELECTION BACKGROUND */}

  <span
    aria-hidden="true"
    className={`
      pointer-events-none absolute bottom-1 left-1 top-1
      w-[calc(50%-4px)] rounded-full shadow-sm
      transition-all duration-300
      ease-[cubic-bezier(0.22,1,0.36,1)]
      ${
        foodType === "VEG"
          ? "translate-x-0 bg-[#00a850] opacity-100"
          : foodType === "NON_VEG"
            ? "translate-x-full bg-[#e33445] opacity-100"
            : "translate-x-0 bg-transparent opacity-0"
      }
    `}
  />

  {/* VEG BUTTON */}

  <button
    type="button"
    onClick={() =>
      setFoodType((current) =>
        current === "VEG" ? "ALL" : "VEG"
      )
    }
    aria-pressed={foodType === "VEG"}
    className={`
      relative z-10 flex h-full w-full min-w-0
      items-center justify-center rounded-full
      whitespace-nowrap text-xs font-bold
      transition-colors duration-300
      sm:text-sm
      ${
        foodType === "VEG"
          ? "text-white"
          : "text-[#374151] dark:text-gray-200"
      }
    `}
  >
    <span>Veg</span>
  </button>

  {/* NON-VEG BUTTON */}

  <button
    type="button"
    onClick={() =>
      setFoodType((current) =>
        current === "NON_VEG" ? "ALL" : "NON_VEG"
      )
    }
    aria-pressed={foodType === "NON_VEG"}
    className={`
      relative z-10 flex h-full w-full min-w-0
      items-center justify-center rounded-full
      whitespace-nowrap text-xs font-bold
      transition-colors duration-300
      sm:text-sm
      ${
        foodType === "NON_VEG"
          ? "text-white"
          : "text-[#374151] dark:text-gray-200"
      }
    `}
  >
    <span>Non-Veg</span>
  </button>
</div>
          </div>
        </div>

        {/* ==================================================
            CATEGORY CHIPS
        ================================================== */}

        <div className="mt-4 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <CategoryChip
            label="All"
            active={selectedCategory === "ALL"}
            onClick={() => setSelectedCategory("ALL")}
          />

          {categories.map((category) => (
            <CategoryChip
              key={category}
              label={category}
              active={selectedCategory === category}
              onClick={() =>
                setSelectedCategory(category)
              }
            />
          ))}
        </div>

        {/* ==================================================
            RESULT COUNT
        ================================================== */}

        <div className="mb-4 mt-5 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold tracking-tight">
              Recommended
            </h3>

            <p
              aria-live="polite"
              className="mt-1 text-xs text-[var(--text-secondary)]"
            >
              {filteredFoods.length}{" "}
              {filteredFoods.length === 1
                ? "dish"
                : "dishes"}
              {hasFilters ? " found" : ""}
            </p>
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="shrink-0 text-xs font-bold text-[var(--brand)] transition hover:opacity-75"
            >
              Clear all
            </button>
          )}
        </div>

        {/* ==================================================
            CLOSED STALL NOTICE
        ================================================== */}

        {!stall.is_open && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
              <Clock3 size={19} />
            </div>

            <div className="min-w-0">
              <p className="text-sm font-bold">
                This stall is currently closed
              </p>

              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                You can still browse the menu. Ordering
                will be available when the stall opens.
              </p>

              {stall.opening_time && (
                <p className="mt-2 text-xs font-semibold text-[var(--brand)]">
                  Opening time: {stall.opening_time}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ==================================================
            FOOD LIST
        ================================================== */}

        {filteredFoods.length === 0 ? (
          <EmptyState
            hasFilters={hasFilters}
            onClear={clearFilters}
          />
        ) : (
          <div className="space-y-7">
            {categorySections.map((section) => (
              <section
                key={section.category}
                id={`stall-category-${section.index}`}
                aria-labelledby={`stall-category-heading-${section.index}`}
                className="scroll-mt-24"
              >
                <div className="mb-3 flex items-end justify-between gap-3">
                  <h3
                    id={`stall-category-heading-${section.index}`}
                    className="text-lg font-extrabold tracking-tight sm:text-xl"
                  >
                    {section.category}
                  </h3>
                  <span className="shrink-0 text-xs font-semibold text-[var(--text-muted)]">
                    {section.foods.length}{" "}
                    {section.foods.length === 1 ? "item" : "items"}
                  </span>
                </div>

                <div className="space-y-3">
                  {section.foods.map((food) => (
                    <FoodListCard
                      key={food._id}
                      food={food}
                      quantity={getQuantity(food.name, food.stall_id)}
                      canOrder={stall.is_open}
                      onAdd={() => handleAddToCart(food)}
                      onIncrease={() => handleIncreaseQuantity(food)}
                      onDecrease={() => handleDecreaseQuantity(food)}
                    />
                  ))}
                </div>
              </section>
            ))}

            {uncategorizedFoods.length > 0 && (
              <div className="space-y-3">
                {uncategorizedFoods.map((food) => (
                  <FoodListCard
                    key={food._id}
                    food={food}
                    quantity={getQuantity(food.name, food.stall_id)}
                    canOrder={stall.is_open}
                    onAdd={() => handleAddToCart(food)}
                    onIncrease={() => handleIncreaseQuantity(food)}
                    onDecrease={() => handleDecreaseQuantity(food)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ======================================================
          FILTER BOTTOM SHEET
      ====================================================== */}

      {activeSheet === "filter" && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-5">
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setActiveSheet(null)}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          />

          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="filter-sheet-title"
            className="relative z-10 max-h-[88dvh] w-full overflow-y-auto rounded-t-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6"
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[var(--border-strong)] sm:hidden" />

            <div className="flex items-center justify-between gap-4">
              <div>
                <h2
                  id="filter-sheet-title"
                  className="text-xl font-black tracking-tight"
                >
                  Filters
                </h2>

                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Find exactly what you are craving.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setDraftFilters({
                    category: "ALL",
                    foodType: "ALL",
                    minPrice: "",
                    maxPrice: "",
                    availableOnly: false,
                  })
                }
                className="text-xs font-bold text-[var(--brand)]"
              >
                Reset
              </button>
            </div>

            {/* CATEGORY */}

            <div className="mt-7">
              <label
                htmlFor="sheet-category"
                className="text-sm font-bold"
              >
                Category
              </label>

              <div className="relative mt-3">
                <select
                  id="sheet-category"
                  value={draftFilters.category}
                  onChange={(event) =>
                    setDraftFilters((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                  className="h-12 w-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 pr-10 text-sm outline-none focus:border-[var(--brand)]"
                >
                  <option value="ALL">
                    All categories
                  </option>

                  {categories.map((category) => (
                    <option
                      key={category}
                      value={category}
                    >
                      {category}
                    </option>
                  ))}
                </select>

                <ChevronDown
                  size={16}
                  className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                />
              </div>
            </div>

            {/* FOOD TYPE */}

            <div className="mt-6">
              <p className="text-sm font-bold">
                Food type
              </p>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {(
                  [
                    ["ALL", "All"],
                    ["VEG", "Vegetarian"],
                    ["NON_VEG", "Non-Veg"],
                  ] as const
                ).map(([value, label]) => {
                  const active =
                    draftFilters.foodType === value;

                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        setDraftFilters((current) => ({
                          ...current,
                          foodType: value,
                        }))
                      }
                      className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-bold transition ${
                        active
                          ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                          : "border-[var(--border)] bg-[var(--background)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {active && <Check size={13} />}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* PRICE */}

            <div className="mt-6">
              <p className="text-sm font-bold">
                Price range
              </p>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <label>
                  <span className="mb-2 block text-xs text-[var(--text-secondary)]">
                    Minimum price
                  </span>

                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={draftFilters.minPrice}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        minPrice: event.target.value,
                      }))
                    }
                    placeholder="₹ Min"
                    className="h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--brand)]"
                  />
                </label>

                <label>
                  <span className="mb-2 block text-xs text-[var(--text-secondary)]">
                    Maximum price
                  </span>

                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={draftFilters.maxPrice}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        maxPrice: event.target.value,
                      }))
                    }
                    placeholder="₹ Max"
                    className="h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--brand)]"
                  />
                </label>
              </div>

              {invalidDraftPrice && (
                <p className="mt-2 text-xs text-red-500">
                  Enter valid prices. Minimum must not
                  exceed maximum.
                </p>
              )}
            </div>

            {/* AVAILABILITY */}

            <label className="mt-6 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-[var(--border)] p-4">
              <div>
                <p className="text-sm font-bold">
                  Available now
                </p>

                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Show only available dishes.
                </p>
              </div>

              <input
                type="checkbox"
                checked={draftFilters.availableOnly}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    availableOnly: event.target.checked,
                  }))
                }
                className="h-5 w-5 accent-[var(--brand)]"
              />
            </label>

            {/* ACTIONS */}

            <div className="mt-7 grid grid-cols-[1fr_1.3fr] gap-3">
              <button
                type="button"
                onClick={() =>
                  setDraftFilters({
                    category: "ALL",
                    foodType: "ALL",
                    minPrice: "",
                    maxPrice: "",
                    availableOnly: false,
                  })
                }
                className="h-12 rounded-xl border border-[var(--border)] text-sm font-bold transition hover:bg-[var(--surface-secondary)]"
              >
                Clear all
              </button>

              <button
                type="button"
                disabled={invalidDraftPrice}
                onClick={applyFilters}
                className="h-12 rounded-xl bg-[var(--brand)] text-sm font-bold text-white transition hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply filters
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ======================================================
          SORT BOTTOM SHEET
      ====================================================== */}

      {activeSheet === "sort" && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-5">
          <button
            type="button"
            aria-label="Close sorting options"
            onClick={() => setActiveSheet(null)}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          />

          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="sort-sheet-title"
            className="relative z-10 w-full rounded-t-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-md sm:rounded-3xl sm:p-6"
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[var(--border-strong)] sm:hidden" />

            <div className="flex items-center justify-between">
              <h2
                id="sort-sheet-title"
                className="text-xl font-black"
              >
                Sort by
              </h2>

              <button
                type="button"
                onClick={() => setActiveSheet(null)}
                aria-label="Close sort options"
                className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-[var(--surface-secondary)]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-1">
              {(
                [
                  "recommended",
                  "price-asc",
                  "price-desc",
                  "name-asc",
                ] as SortOption[]
              ).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setSortBy(option);
                    setActiveSheet(null);
                  }}
                  className={`flex min-h-12 w-full items-center justify-between rounded-xl px-4 text-left text-sm transition ${
                    sortBy === option
                      ? "bg-[var(--brand-soft)] font-bold text-[var(--brand)]"
                      : "text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]"
                  }`}
                >
                  {sortLabels[option]}

                  {sortBy === option && (
                    <Check size={17} />
                  )}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ======================================================
          FLOATING MENU BUTTON
      ====================================================== */}
      <button
        ref={menuButtonRef}
        type="button"
        onClick={() => setIsMenuOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isMenuOpen}
        aria-controls="stall-category-menu"
        className="fixed right-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-extrabold text-[var(--text-primary)] shadow-[0_8px_28px_rgba(0,0,0,0.16)] transition hover:-translate-y-0.5 hover:border-[var(--brand)] hover:text-[var(--brand)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--brand)]/30 sm:right-6"
        style={{
          bottom:
            cartItemCount > 0
              ? "calc(env(safe-area-inset-bottom, 0px) + 5.75rem)"
              : "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
        }}
      >
        <List size={18} strokeWidth={2.2} />
        Menu
      </button>

      {/* ======================================================
          FULL CATEGORY MENU
      ====================================================== */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-[110]">
          <button
            type="button"
            aria-label="Close category menu"
            onClick={() => setIsMenuOpen(false)}
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
          />

          <section
            id="stall-category-menu"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stall-category-menu-title"
            className="absolute inset-x-3 bottom-3 flex max-h-[min(72dvh,36rem)] flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:inset-x-auto sm:right-6 sm:w-[22rem]"
            style={{
              bottom:
                cartItemCount > 0
                  ? "calc(env(safe-area-inset-bottom, 0px) + 10.25rem)"
                  : "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)",
            }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[var(--brand)]">
                  {stall.name}
                </p>
                <h2
                  id="stall-category-menu-title"
                  className="mt-1 text-xl font-black tracking-tight"
                >
                  Browse categories
                </h2>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Jump straight to your favourite dishes.
                </p>
              </div>

              <button
                type="button"
                autoFocus
                onClick={() => setIsMenuOpen(false)}
                aria-label="Close category menu"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--text-secondary)] transition hover:bg-[var(--surface-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <X size={19} />
              </button>
            </div>

            <div className="overflow-y-auto overscroll-contain p-3">
              {categories.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-[var(--text-secondary)]">
                  No categories are available for this stall yet.
                </p>
              ) : (
                <div className="space-y-1">
                  {categories.map((category, index) => {
                    const itemCount = data.foods.filter(
                      (food) =>
                        (food.category || "").trim() === category
                    ).length;

                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() =>
                          navigateToCategory(category, index)
                        }
                        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 text-left transition hover:bg-[var(--brand-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                      >
                        <span className="min-w-0 truncate text-sm font-bold text-[var(--text-primary)]">
                          {category}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
                          {itemCount} {itemCount === 1 ? "item" : "items"}
                          <ArrowRight size={15} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ======================================================
          STICKY CART BAR
      ====================================================== */}

      {cartItemCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
          <button
            type="button"
            onClick={() => router.push("/cart")}
            aria-label={`Open cart with ${cartItemCount} ${cartLabel}`}
            className="mx-auto flex min-h-[60px] w-full max-w-xl items-center justify-between gap-3 rounded-2xl bg-[var(--brand)] px-4 py-3 text-white shadow-[0_12px_40px_rgba(0,0,0,0.20)] transition hover:bg-[var(--brand-hover)] active:scale-[0.99] sm:max-w-2xl sm:px-5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <ShoppingCart size={21} />

                <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-[var(--brand)] bg-white px-1 text-[9px] font-black text-[var(--brand)]">
                  {cartItemCount}
                </span>
              </div>

              <div className="min-w-0 text-left">
                <p className="text-sm font-extrabold">
                  {cartItemCount} {cartLabel}
                </p>

                <p className="mt-0.5 text-xs text-white/75">
                  {formatPrice(cartTotal)}
                </p>
              </div>
            </div>

            <span className="inline-flex shrink-0 items-center gap-2 text-sm font-bold">
              View cart
              <ArrowRight size={17} />
            </span>
          </button>
        </div>
      )}
    </main>
  );
}

/* ============================================================
   STALL META
============================================================ */

function StallMeta({
  icon,
  label,
  value,
  positive = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-4 sm:px-5 sm:py-5">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          positive
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-[var(--surface-secondary)] text-[var(--text-muted)]"
        }`}
      >
        {icon}
      </div>

      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </p>

        <p
          className={`mt-1 truncate text-xs font-bold sm:text-sm ${
            positive
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-[var(--text-primary)]"
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

/* ============================================================
   CATEGORY CHIP
============================================================ */

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 shrink-0 rounded-full px-4 text-xs font-bold transition-all duration-200 ${
        active
          ? "bg-[var(--brand)] text-white shadow-sm"
          : "border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--brand)] hover:text-[var(--brand)]"
      }`}
    >
      {label}
    </button>
  );
}

/* ============================================================
   PREMIUM SEGMENTED DIETARY TOGGLE
============================================================ */

function DietToggle({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: "green" | "red";
  onClick: () => void;
}) {
  const isVeg = color === "green";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Filter ${label} dishes`}
      className={`
        relative inline-flex h-12 w-[280px] shrink-0
        items-center rounded-full
        border border-[#e5e7eb]
        bg-[#f3f4f6]
        p-[4px]
        shadow-sm
        transition-colors duration-300
        focus-visible:outline-none
        focus-visible:ring-2
        focus-visible:ring-[#00a850]
        focus-visible:ring-offset-2
        dark:border-[#454b58]
        dark:bg-[#252a34]
        sm:w-[320px]
      `}
    >
      {/* Animated selected background */}
      <span
        aria-hidden="true"
        className={`
          absolute bottom-[4px] top-[4px]
          w-[calc(50%-4px)]
          rounded-full
          bg-[#00a850]
          shadow-sm
          transition-transform duration-300
          ease-[cubic-bezier(0.22,1,0.36,1)]
          ${
            active
              ? isVeg
                ? "translate-x-0"
                : "translate-x-full"
              : isVeg
                ? "translate-x-0 opacity-0"
                : "translate-x-full opacity-0"
          }
        `}
      />

      {/* Veg option */}
      <span
        className={`
          relative z-10 flex h-full w-1/2
          items-center justify-center gap-2
          rounded-full
          text-base font-bold
          transition-colors duration-300
          sm:text-lg
          ${
            isVeg && active
              ? "text-white"
              : !isVeg && !active
                ? "text-[#374151] dark:text-gray-200"
                : "text-[#374151] dark:text-gray-200"
          }
        `}
      >
        {isVeg ? (
          <Leaf
            size={22}
            strokeWidth={2.5}
            className={
              active
                ? "text-white"
                : "text-[#00a850]"
            }
          />
        ) : (
          <UtensilsCrossed
            size={22}
            strokeWidth={2.3}
            className={
              active
                ? "text-white"
                : "text-[#e33445]"
            }
          />
        )}

        {label}
      </span>
    </button>
  );
}

/* ============================================================
   FOOD LIST CARD
============================================================ */

function FoodListCard({
  food,
  quantity,
  canOrder,
  onAdd,
  onIncrease,
  onDecrease,
}: {
  food: Food;
  quantity: number;
  canOrder: boolean;
  onAdd: () => void;
  onIncrease: () => void;
  onDecrease: () => void;
}) {
  const [imageFailed, setImageFailed] =
    useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [food._id, food.image]);

  const imageUrl =
    food.image && !imageFailed
      ? getImageUrl(food.image)
      : null;

  const available =
    food.available && canOrder;

  return (
    <article className="group flex min-w-0 gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm transition duration-200 hover:border-[var(--border-strong)] hover:shadow-md sm:gap-4 sm:p-4">

      {/* FOOD IMAGE */}

      <div className="relative h-[112px] w-[112px] shrink-0 overflow-hidden rounded-xl bg-[var(--surface-secondary)] sm:h-[130px] sm:w-[140px]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={food.name}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 ${
              available ? "" : "opacity-60"
            }`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <UtensilsCrossed
              size={25}
              className="text-[var(--text-muted)]"
            />
          </div>
        )}



        {/* VEG INDICATOR */}

        {food.is_veg !== null && (
          <span
            aria-label={
              food.is_veg
                ? "Vegetarian"
                : "Non-vegetarian"
            }
            title={
              food.is_veg
                ? "Vegetarian"
                : "Non-vegetarian"
            }
            className={`absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-md border bg-white shadow-sm ${
              food.is_veg
                ? "border-green-600"
                : "border-red-500"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                food.is_veg
                  ? "bg-green-600"
                  : "bg-red-500"
              }`}
            />
          </span>
        )}

        {!food.available && (
          <span className="absolute inset-x-1 bottom-1 rounded-md bg-black/65 px-1 py-1 text-center text-[9px] font-bold text-white">
            Sold out
          </span>
        )}
      </div>

      {/* FOOD INFORMATION */}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-w-0">
          {food.category && (
            <p className="mb-1 truncate text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {food.category}
            </p>
          )}

          <h3 className="line-clamp-2 text-sm font-extrabold leading-5 tracking-tight text-[var(--text-primary)] sm:text-base">
            {food.name}
          </h3>

          <div className="-mt-1 mb-1 flex justify-end">
            <HeartFavorite foodName={food.name} />
          </div>

          {food.description && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-secondary)] sm:text-xs">
              {food.description}
            </p>
          )}
        </div>

        {/* PRICE + ADD */}

        <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-3">
          <p className="text-sm font-black tracking-tight text-[var(--text-primary)] sm:text-base">
            {formatPrice(food.price)}
          </p>

          {!available ? (
            <span className="rounded-lg bg-[var(--surface-secondary)] px-2 py-1.5 text-[10px] font-bold text-[var(--text-muted)]">
              {canOrder ? "Unavailable" : "Stall closed"}
            </span>
          ) : quantity > 0 ? (
            <div className="inline-flex h-8 shrink-0 items-center overflow-hidden rounded-lg border border-[var(--brand)] bg-[var(--brand)] text-white">
              <button
                type="button"
                onClick={onDecrease}
                aria-label={`Remove one ${food.name}`}
                className="flex h-full w-8 items-center justify-center text-base font-bold transition hover:bg-black/10"
              >
                −
              </button>

              <span
                aria-live="polite"
                className="min-w-5 text-center text-xs font-extrabold"
              >
                {quantity}
              </span>

              <button
                type="button"
                onClick={onIncrease}
                aria-label={`Add one ${food.name}`}
                className="flex h-full w-8 items-center justify-center text-base font-bold transition hover:bg-black/10"
              >
                +
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--brand)] bg-[var(--brand-soft)] px-3 text-[11px] font-extrabold text-[var(--brand)] transition hover:bg-[var(--brand)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              ADD
              <span className="text-sm leading-none">
                +
              </span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/* ============================================================
   EMPTY STATE
============================================================ */

function EmptyState({
  hasFilters,
  onClear,
}: {
  hasFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--border)] px-6 py-12 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--surface-secondary)]">
        <Search
          size={32}
          strokeWidth={1.6}
          className="text-[var(--text-muted)]"
        />
      </div>

      <h3 className="mt-5 text-lg font-extrabold">
        No dishes found
      </h3>

      <p className="mt-2 max-w-xs text-sm leading-6 text-[var(--text-secondary)]">
        Try another search or adjust your filters
        to discover more dishes.
      </p>

      {hasFilters && (
        <button
          type="button"
          onClick={onClear}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--brand)] px-4 text-sm font-bold text-[var(--brand)] transition hover:bg-[var(--brand-soft)]"
        >
          <Filter size={15} />
          Clear filters
        </button>
      )}
    </div>
  );
}

/* ============================================================
   LOADING SKELETON
============================================================ */

function StallPageSkeleton() {
  return (
    <main className="min-h-screen bg-[var(--background)] pb-10">
      {/* HERO */}

      <div className="h-[250px] animate-pulse bg-[var(--surface-secondary)] sm:h-[330px] lg:h-[390px]" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* META */}

        <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          {[0, 1].map((item) => (
            <div
              key={item}
              className="flex items-center gap-3 p-4"
            >
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-[var(--surface-secondary)]" />

              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-20 animate-pulse rounded bg-[var(--surface-secondary)]" />

                <div className="h-4 w-28 max-w-full animate-pulse rounded bg-[var(--surface-secondary)]" />
              </div>
            </div>
          ))}
        </div>

        {/* TITLE */}

        <div className="mt-8 space-y-3">
          <div className="h-7 w-48 animate-pulse rounded-lg bg-[var(--surface-secondary)]" />

          <div className="h-4 w-60 animate-pulse rounded-lg bg-[var(--surface-secondary)]" />
        </div>

        {/* SEARCH */}

        <div className="mt-5 h-12 animate-pulse rounded-2xl bg-[var(--surface-secondary)]" />

        {/* CATEGORY CHIPS */}

        <div className="mt-4 flex gap-2 overflow-hidden">
          {[60, 85, 70, 95, 75].map(
            (width, index) => (
              <div
                key={index}
                style={{ width }}
                className="h-9 shrink-0 animate-pulse rounded-full bg-[var(--surface-secondary)]"
              />
            )
          )}
        </div>

        {/* FOOD CARDS */}

        <div className="mt-7 space-y-3">
          {Array.from({ length: 5 }).map(
            (_, index) => (
              <div
                key={index}
                className="flex gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3"
              >
                <div className="h-[112px] w-[112px] shrink-0 animate-pulse rounded-xl bg-[var(--surface-secondary)]" />

                <div className="flex flex-1 flex-col gap-3 py-1">
                  <div className="h-3 w-16 animate-pulse rounded bg-[var(--surface-secondary)]" />

                  <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--surface-secondary)]" />

                  <div className="h-3 w-full animate-pulse rounded bg-[var(--surface-secondary)]" />

                  <div className="mt-auto h-8 w-20 animate-pulse self-end rounded-lg bg-[var(--surface-secondary)]" />
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </main>
  );
}
