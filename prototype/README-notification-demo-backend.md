# Notification demo preview backend

Isolated stdlib Node service for synthetic notification read/delivery state only. Not production LK storage.

## Start (required for preview persistence)

```bash
node prototype/notification-demo-server.mjs
```

Listens on `0.0.0.0:34113`. Data file: `prototype/.data/notification-demo-state.json` (gitignored).

## Static prototype

Deploy `site/` only. `site/index.html` sets `window.__NOTIFICATION_DEMO_API__="__PORT_34113__"`; the preview platform rewrites this to the proxied API base. On local origins (`127.0.0.1` / `localhost`) the client uses `http://127.0.0.1:34113`.

## Visitor scope

- `GET|PUT|DELETE /v1/demo-notification-state`
- Header `X-Visitor-Id` (8–128 chars, `[\w.-]`) required except loopback, where `local-dev-visitor` is used if omitted.
- Hosted preview: proxy must inject `X-Visitor-Id`; the browser client must not invent a shared visitor id.

## Local QA visitor override

On localhost only: `window.__NOTIFICATION_DEMO_VISITOR__` before hydration (Playwright init script).

## Tests

```bash
node prototype/notification-demo-server.mjs &
node notification-demo-api-qa.mjs
node run-browser-qa.mjs notification-center-qa.js
```
