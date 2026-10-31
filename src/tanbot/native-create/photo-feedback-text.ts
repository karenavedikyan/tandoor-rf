/** User-visible prefix for native photo step replies (always includes actual saved count). */
export function formatPhotoStepFeedback(added: number, countAfter: number, errors: string[]): string {
  const parts: string[] = [];
  if (added > 0) {
    parts.push(added === 1 ? "Добавлено 1 фото." : `Добавлено ${added} фото.`);
  }
  parts.push(`Фото: ${countAfter}/5.`);
  for (const e of errors) parts.push(e);
  return parts.join("\n");
}
