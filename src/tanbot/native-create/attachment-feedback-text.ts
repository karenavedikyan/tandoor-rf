import { formatPhotoStepFeedback } from "./photo-feedback-text";

export type NativeAttachmentAddCounts = {
  addedImages: number;
  addedPdfs: number;
  addedOther: number;
};

export function formatNativeAttachmentStepFeedback(
  added: NativeAttachmentAddCounts,
  countAfter: number,
  errors: string[],
  useGenericLabels: boolean,
): string {
  const imageOnlyBatch =
    !useGenericLabels && added.addedPdfs === 0 && added.addedOther === 0 && added.addedImages > 0;
  if (imageOnlyBatch && errors.length === 0) {
    return formatPhotoStepFeedback(added.addedImages, countAfter, errors);
  }
  if (
    !useGenericLabels &&
    added.addedPdfs === 0 &&
    added.addedOther === 0 &&
    errors.length > 0 &&
    added.addedImages === 0
  ) {
    return formatPhotoStepFeedback(0, countAfter, errors);
  }
  const parts: string[] = [];
  if (added.addedImages > 0) {
    parts.push(added.addedImages === 1 ? "Добавлено 1 фото." : `Добавлено ${added.addedImages} фото.`);
  }
  if (added.addedPdfs > 0) {
    parts.push(added.addedPdfs === 1 ? "Добавлен PDF." : `Добавлено ${added.addedPdfs} PDF.`);
  }
  if (added.addedOther > 0) {
    parts.push(added.addedOther === 1 ? "Добавлен файл." : `Добавлено ${added.addedOther} файлов.`);
  }
  parts.push(`Файлы: ${countAfter}/5.`);
  for (const e of errors) parts.push(e);
  return parts.join("\n");
}

export function nativeAttachmentLimitMessage(useGenericLabels: boolean): string {
  return useGenericLabels ?
      "Достигнут лимит 5 файлов. Нажмите «Далее»."
    : "Достигнут лимит 5 фото. Нажмите «Далее».";
}
