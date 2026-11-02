import {
  parseOpenLineHolderPresentation,
  publicTanTrackerBrandPreviewUrl,
} from "./open-line-holder-presentation";
import { receivedTrackMenuCallback } from "../received-track-actions";

type ReplyMarkup = { inline_keyboard: Array<Array<
  { text: string; url: string; callback_data?: never } | { text: string; callback_data: string; url?: never }
>> };

export type TelegramExternalPersonOutboxPresentation =
  | {
      mode: "rich";
      text: string;
      holderUrl: string;
      replyMarkup: ReplyMarkup;
      linkPreviewOptions: {
        is_disabled: false;
        url: string;
        prefer_large_media: true;
      };
    }
  | {
      mode: "plain";
      text: string;
      disableWebPagePreview: true;
      replyMarkup?: ReplyMarkup;
    };

export function buildTelegramExternalPersonOutboxPresentation(
  storedBody: string,
  appOrigin: string,
): TelegramExternalPersonOutboxPresentation {
  const parsed = parseOpenLineHolderPresentation(storedBody, appOrigin);
  const callback = receivedTrackMenuCallback(storedBody);
  const replyMarkup: ReplyMarkup | undefined = callback
    ? { inline_keyboard: [[{ text: "Мои передачи", callback_data: callback }]] } : undefined;
  if (parsed.mode !== "rich") {
    return { mode: "plain", text: parsed.text, disableWebPagePreview: true, ...(replyMarkup ? { replyMarkup } : {}) };
  }

  const previewUrl = publicTanTrackerBrandPreviewUrl(appOrigin);
  if (!previewUrl) {
    return { mode: "plain", text: storedBody.replace(/\r\n/g, "\n"), disableWebPagePreview: true, ...(replyMarkup ? { replyMarkup } : {}) };
  }

  return {
    mode: "rich",
    text: parsed.text,
    holderUrl: parsed.holderUrl,
    replyMarkup: replyMarkup ?? {
      inline_keyboard: [[{ text: "Открыть передачу", url: parsed.holderUrl }]],
    },
    linkPreviewOptions: {
      is_disabled: false,
      url: previewUrl,
      prefer_large_media: true,
    },
  };
}
