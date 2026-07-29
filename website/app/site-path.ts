const configuredBase = import.meta.env.BASE_URL || "/";
const normalizedBase = configuredBase === "/" ? "" : configuredBase.replace(/\/$/, "");

export function sitePath(path = ""): string {
  const normalizedPath = path.replace(/^\//, "");
  if (!normalizedPath) return normalizedBase ? `${normalizedBase}/` : "/";
  return `${normalizedBase}/${normalizedPath}`;
}
