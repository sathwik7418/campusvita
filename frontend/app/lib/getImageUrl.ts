const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export function getImageUrl(image: string) {
  if (!image?.trim()) {
    return "";
  }

  const value = image.trim();

  // Preserve absolute image URLs.
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  // Uploaded images are served by FastAPI, not Next.js.
  const normalizedPath = value.startsWith("/")
    ? value
    : `/${value}`;

  if (normalizedPath.startsWith("/uploads/")) {
    return `${API_URL.replace(/\/+$/, "")}${normalizedPath}`;
  }

  // Preserve local Next.js public assets.
  return normalizedPath;
}