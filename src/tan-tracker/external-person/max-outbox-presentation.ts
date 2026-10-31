import type { MaxInlineButton } from "../../tanbot-max/delivery-transport";
import { parseOpenLineHolderPresentation } from "./open-line-holder-presentation";

export type MaxExternalPersonOutboxPresentation =
  | {
      mode: "rich";
      text: string;
      shareUrl: string;
      inlineButtons: MaxInlineButton[][];
    }
  | { mode: "plain"; text: string };

export function buildMaxExternalPersonOutboxPresentation(
  storedBody: string,
  appOrigin: string,
): MaxExternalPersonOutboxPresentation {
  const parsed = parseOpenLineHolderPresentation(storedBody, appOrigin);
  if (parsed.mode !== "rich") {
    return { mode: "plain", text: parsed.text };
  }

  return {
    mode: "rich",
    text: parsed.text,
    shareUrl: parsed.holderUrl,
    inlineButtons: [[{ type: "link", text: "Открыть передачу", url: parsed.holderUrl }]],
  };
}
