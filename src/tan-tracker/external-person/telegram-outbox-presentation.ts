import {
  parseOpenLineHolderPresentation,
  publicTanTrackerBrandPreviewUrl,
} from "./open-line-holder-presentation";

export type TelegramExternalPersonOutboxPresentation =
  | {
      mode: "rich";
      text: string;
      holderUrl: string;
      replyMarkup: {
        inline_keyboard: Array<Array<{ text: string; url: string }>>;
      };
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
    };

export function buildTelegramExternalPersonOutboxPresentation(
  storedBody: string,
  appOrigin: string,
): TelegramExternalPersonOutboxPresentation {
  const parsed = parseOpenLineHolderPresentation(storedBody, appOrigin);
  if (parsed.mode !== "rich") {
    return { mode: "plain", text: parsed.text, disableWebPagePreview: true };
  }

  const previewUrl = publicTanTrackerBrandPreviewUrl(appOrigin);
  if (!previewUrl) {
    return { mode: "plain", text: storedBody.replace(/\r\n/g, "\n"), disableWebPagePreview: true };
  }

  return {
    mode: "rich",
    text: parsed.text,
    holderUrl: parsed.holderUrl,
    replyMarkup: {
      inline_keyboard: [[{ text: "Открыть передачу", url: parsed.holderUrl }]],
    },
    linkPreviewOptions: {
      is_disabled: false,
      url: previewUrl,
      prefer_large_media: true,
    },
  };
}
