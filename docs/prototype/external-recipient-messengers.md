# External recipient: Telegram / MAX (unified prototype)

Prototype-only flow in `site/tan-tracker.js` + `site/tan-tracker-messenger-demo.js`. No production bots, webhooks, or SMS.

## UX

- Sender shares **personal invitation link or QR** from the handoff panel (`tt_st` start token on the URL).
- Recipient opens the public recipient shell (no LK), **chooses Telegram or MAX** (recipient choice, not sender guess).
- Demo simulates native **share contact**; one-time code appears **only on the recipient screen**.
- Holder enters the code manually; custody changes only after successful confirm.
- **MAX** is shown with an honest disabled state unless `window.__TT_MESSENGER_DEMO__.maxEnabled === true` (QA / isolated demo).

## Invalidation

- Changing recipient, handoff version, or channel invalidates prior codes, QR, invitations, and messenger proof.
- External pending transfers hide holder **«Получить демо-код»** (no OTP leak to sender).

## QA

```bash
node run-browser-qa.mjs tan-tracker-external-messenger-qa.js
node run-browser-qa.mjs tan-tracker-handoff-identity-qa.js
node run-browser-qa.mjs notification-center-qa.js
```

Production implementation is tracked separately on branch `cursor/external-recipient-messengers-20261029` from published backend baseline — not this prototype site tree.
