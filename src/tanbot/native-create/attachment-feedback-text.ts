import { formatPhotoStepFeedback } from "./photo-feedback-text";

export type NativeAttachmentAddCounts = {
  addedImages: number;
  addedPdfs: number;
};

export function formatNativeAttachmentStepFeedback(
  added: NativeAttachmentAddCounts,
  countAfter: number,
  errors: string[],
  draftHasPdf: boolean,
): string {
  const imageOnlyDraft = !draftHasPdf && added.addedPdfs === 0;
  if (imageOnlyDraft) {
    return formatPhotoStepFeedback(added.addedImages, countAfter, errors);
  }
  const parts: string[] = [];
  if (added.addedImages > 0) {
    parts.push(added.addedImages === 1 ? "Добавлено 1 фото." : `Добавлено ${added.addedImages} фото.`);
  }
  if (added.addedPdfs > 0) {
    parts.push(added.addedPdfs === 1 ? "Добавлен PDF." : `Добавлено ${added.addedPdfs} PDF.`);
  }
  parts.push(`Файлы: ${countAfter}/5.`);
  for (const e of errors) parts.push(e);
  return parts.join("\n");
}

export function nativeAttachmentLimitMessage(draftHasPdf: boolean): string {
  return draftHasPdf ? "Достигнут лимит 5 файлов. Нажмите «Далее»." : "Достигнут лимит 5 фото. Нажмите «Далее».";
}
