# API abuse protection

The backend already had IP limits. This update adds account-based limits, persistent service-wide quotas, ownership checks, and separate controls for live voice. The frontend cannot bypass these checks. The Gemini key remains in the backend environment.

## Default limits

| Layer | Default | Persistence |
| --- | --- | --- |
| All HTTP API requests | 100 per IP per 15 minutes | Per server process |
| All interview endpoints, including rating/finalize/results | 30 per account per minute | Per server process |
| All interview endpoints | 200 per account per UTC day | Shared MongoDB |
| New interview starts | 10 per account per hour, plus the existing 20 per IP per hour | Account quota in MongoDB; IP burst limit per process |
| Text/JSON Gemini generation | 1,000 invocations across the service per UTC day | Shared MongoDB |
| Signup and verification email resends | Shared 5 per IP per 15 minutes | Per server process |
| Login and OTP/reset verification | Shared 10 per IP per 15 minutes | Per server process |
| Voice upgrade attempts | 30 per source socket IP per hour | Shared MongoDB |
| Voice sessions | 4 per account and 50 service-wide per UTC day | Shared MongoDB |
| Simultaneous voice connections | 1 per account per server process, including pending connections | Per server process |
| Voice duration | 15 minutes per connection, including connection setup | Connection timer |
| Incoming audio | At most 15 minutes of 16 kHz, 16-bit PCM per connection | Decoded byte counter |
| WebSocket traffic | 64 KiB per frame, 100 frames and 128 KiB per second | Connection counters |
| Voice text | 2,000 characters per message, at least 2 seconds between text messages | Connection counters |
| JSON request body | 96 KiB | Express parser |
| Combined provider prompt and system instruction | 160 KiB UTF-8 | Provider boundary |
| Text/JSON generation output | 2,048 tokens per invocation | Gemini request configuration |
| Text/JSON generation request timeout | 60 seconds | Gemini request configuration |

Daily/hourly Mongo quotas use fixed windows aligned to UTC, while the short Express limits use the library's windows. Rejected attempts and provider failures count toward reserved quotas. A voice reservation is not refunded if the subsequent provider connection fails. This conservative accounting prevents retries from becoming a free bypass; it may reduce a legitimate user's remaining allowance after a service failure.

The shared quota collection uses atomic increments with an `_id` unique key and a TTL expiry index. Correctness depends on the window ID, not on timely TTL deletion. A first-insert race is retried as an increment. Mongo outages return 503 rather than allowing unlimited AI traffic. Database waits are bounded and command buffering is disabled for quota writes.

## Production configuration

Set `NODE_ENV=production`, a working `MONGO_URI`, and a unique `JWT_SECRET` of at least 32 characters. Production rejects the built-in development secret and the example placeholder. Production AI quotas require MongoDB; they do not silently fall back to process memory. Development with no Mongo URI may use bounded, process-local counters.

The following environment variables adjust the defaults:

```dotenv
INTERVIEW_STARTS_PER_HOUR=10
AI_REQUESTS_PER_ACCOUNT_DAY=200
AI_CALLS_PER_DAY=1000
VOICE_SESSIONS_PER_ACCOUNT_DAY=4
VOICE_SESSIONS_PER_DAY=50
VOICE_MAX_MINUTES=15
```

`TRUST_PROXY` is empty/false by default, so changing `X-Forwarded-For` does not change the HTTP limiter identity. If the backend is behind a proxy, configure only that proxy's IPs or CIDRs, for example `TRUST_PROXY=loopback` for a proxy on the same machine. Broad `true` and numeric hop-count values are rejected. The trusted proxy must overwrite forwarding headers, and direct origin access should be restricted at the hosting layer. See [Express's proxy guidance](https://expressjs.com/en/guide/behind-proxies/).

Voice upgrade attempt limits intentionally use the socket IP, not forwarded headers. Behind a proxy, that allowance is shared by users reaching the backend through the same proxy address; tune it in source or add a verified proxy-address resolver if this is too restrictive. Per-account and service-wide voice quotas still apply.

## Authorization and work serialization

Every REST interview ID must belong to the authenticated account before session access or provider work. Live upgrades additionally verify that the account exists, is email-verified, owns the interview, and the session is eligible for voice. Supplied browser origins must match `WEB_URL`. Non-browser clients can omit Origin, so authentication and ownership remain the primary controls.

Within a worker, session HTTP operations are serialized until their handler finishes, even if a client disconnects. Mutating HTTP operations cannot run during that session's voice connection. Live voice reserves its account slot before awaiting quotas/provider startup, drops pre-ready audio instead of buffering it, and stops upstream streaming on invalid traffic, timeout or completion.

Concurrent-session locks are process-local, so they are not a distributed lock for horizontally scaled deployments. Persistent account and service quotas still bound admitted work across those workers. A distributed active-session lease would be the next improvement if strict cross-worker single-session exclusivity is required.

Quota denials return HTTP 429 and `Retry-After`; a quota-store outage returns 503. Provider quota errors propagate through evaluation rather than becoming invented fallback scores. Failed evaluations can be retried. Status model discovery is deduplicated and caches failures for five minutes, preventing status polling from repeatedly calling Google during an outage.

## Verification and remaining limits

`npm test` exercises account caps, ownership on every REST endpoint, concurrent work rejection, forwarding-header spoof attempts, output/input limits, provider admission, Mongo store contracts and first-insert races, quota-store failures, and real local WebSocket handshakes with a fake voice provider. Tests use no real Gemini credentials or production database. The production frontend build also passes.

Mongo persistence behavior is covered with an injected atomic store; a real multi-worker Mongo deployment and paid Gemini traffic were not load-tested. Perform a staging deployment check with your actual proxy addresses and database permissions before relying on the shared counters.

These are usage caps, not a dollar-denominated billing guarantee or complete DDoS protection. SDK/provider retries, model pricing, and other applications sharing a key can affect spend. Keep provider-side project quotas and billing alerts, restrict the API key to the required service, and add edge-level request filtering for volumetric attacks. No provider account or hosting settings were changed by this commit.

Implementation references: [express-rate-limit configuration](https://express-rate-limit.mintlify.app/reference/configuration), [ws payload and server options](https://github.com/websockets/ws/blob/master/doc/ws.md).
