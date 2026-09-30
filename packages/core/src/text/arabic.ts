// Arabic-aware text matching for search boxes: people type names with or
// without hamza, taa marbuta vs haa, alef maqsura vs yaa, diacritics and
// tatweel. Both the query and the text are normalized the same way.
const DIACRITICS = /[ً-ٰٟـ]/g; // harakat, superscript alef, tatweel

export function normalizeArabic(s: string): string {
  return s
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Every word of the query appears somewhere in one of the fields. */
export function matchesSearch(query: string, ...fields: Array<string | null | undefined>): boolean {
  const words = normalizeArabic(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const hay = normalizeArabic(fields.filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
}

/** Arabic alphabetical order (for names). */
// One collator for the whole app: `localeCompare(b, "ar")` builds a new one
// on every call, which is ~100x slower when sorting thousands of names.
const collator = new Intl.Collator("ar");
export const compareArabic = (a: string, b: string) => collator.compare(a, b);
