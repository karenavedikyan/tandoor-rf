# External recipient: Telegram / MAX (unified prototype)

Prototype-only flow in `site/tan-tracker.js` + `site/tan-tracker-messenger-demo.js`. No production bots, webhooks, or SMS.

## UX

- Sender shares **personal invitation link or QR** from the handoff panel (`tt_st` start token on the URL).
- Recipient opens the public recipient shell (no LK), **chooses Telegram or MAX** (recipient choice, not sender guess).
- Demo simulates native **share contact**; one-time code appears **only on the recipient screen**.
- Holder enters the code manually; custody changes only after successful confirm.
- **MAX** is shown with an honest disabled state unless `window.__TT_MESSENGER_DEMO__.maxEnabled === true` (QA / isolated demo).

## After the code

When the holder confirms the one-time code, custody moves to the external recipient. The **same personal invitation URL** (`tt_view=recipient`, matching `tt_hv` / `tt_rcv` / `tt_st`) then opens the **«Предмет у вас»** screen (`data-tt="recipient-received"`) instead of a stale-invite error — only if another person or a newer invitation invalidated that ticket.

- **Intermediate relay** (`finalRecipientId` is someone else): next-step block names the final recipient and due date; **«Открыть мою страницу передачи»** switches to the external holder shell (`tt_act`) with `holder-status-card` and **«Передать дальше»** (same transfer handler as the main app).
- **Final recipient** (or completed track): success copy only; no holder-page button.
- Collapsed **«Сообщение в Telegram|MAX (демо)»** (`data-tt="bot-message-preview"`) shows the plain-text bot message for the code step and for received (final vs relay). Nothing is sent.
- After confirm, the internal holder’s detail view may show **«Что увидит получатель (демо)»** (`data-tt="preview-recipient-received"`) to open the received screen for QA.

## Invalidation

- Changing recipient, handoff version, or channel invalidates prior codes, QR, invitations, and messenger proof.
- External pending transfers hide holder **«Получить демо-код»** (no OTP leak to sender).

## QA

```bash
node run-browser-qa.mjs tan-tracker-external-messenger-qa.js
node run-browser-qa.mjs tan-tracker-handoff-identity-qa.js
node run-browser-qa.mjs tan-tracker-external-after-code-qa.js
node run-browser-qa.mjs notification-center-qa.js
node run-browser-qa.mjs tan-tracker-pre-handoff-edit-qa.js
```

Production implementation is tracked separately on branch `cursor/external-recipient-messengers-20261029` from published backend baseline — not this prototype site tree.
