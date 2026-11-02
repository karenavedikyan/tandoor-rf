import type { MaxInlineButton } from "../../tanbot-max/delivery-transport";
import { parseOpenLineHolderPresentation } from "./open-line-holder-presentation";
import { receivedTrackMenuCallback } from "../received-track-actions";

export type MaxExternalPersonOutboxPresentation =
  | {
      mode: "rich";
      text: string;
      shareUrl: string;
      inlineButtons: MaxInlineButton[][];
    }
  | { mode: "plain"; text: string; inlineButtons?: MaxInlineButton[][] };

export function buildMaxExternalPersonOutboxPresentation(
  storedBody: string,
  appOrigin: string,
): MaxExternalPersonOutboxPresentation {
  const parsed = parseOpenLineHolderPresentation(storedBody, appOrigin);
  const callback = receivedTrackMenuCallback(storedBody);
  const actions: MaxInlineButton[][] = callback
    ? [[{ type: "callback", text: "Мои передачи", payload: callback }]] : [];
  if (parsed.mode !== "rich") {
    return { mode: "plain", text: parsed.text, ...(actions.length ? { inlineButtons: actions } : {}) };
  }

  return {
    mode: "rich",
    text: parsed.text,
    shareUrl: parsed.holderUrl,
    inlineButtons: actions.length ? actions : [[{ type: "link", text: "Открыть передачу", url: parsed.holderUrl }]],
  };
}
