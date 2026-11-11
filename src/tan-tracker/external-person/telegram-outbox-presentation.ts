import { parseOpenLineHolderPresentation } from "./open-line-holder-presentation";
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
        is_disabled: true;
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

  return {
    mode: "rich",
    text: parsed.text,
    holderUrl: parsed.holderUrl,
    replyMarkup: replyMarkup ?? {
      inline_keyboard: [[{ text: "Открыть передачу", url: parsed.holderUrl }]],
    },
    // A generic /tan-tracker/ preview is clickable and opens staff login.
    // Do not use the private holder URL for previews either: keep capability
    // tokens out of preview requests. The button is the only navigation action.
    linkPreviewOptions: {
      is_disabled: true,
    },
  };
}
