/** Disable auto link preview when outbound text may contain capability or untrusted URLs. */
export function applyTelegramWebhookReplyLinkPreviewSafety(
  body: Record<string, unknown>,
  text: string,
  hasReplyMarkup: boolean,
): void {
  if (hasReplyMarkup) {
    body.disable_web_page_preview = true;
    return;
  }
  if (/\bhttps?:\/\//i.test(text)) {
    body.disable_web_page_preview = true;
  }
}
