# Security

This document describes authentication, authorization, rate limiting, data protection, and security best practices for the AI Interviewer.

## Overview

The AI Interviewer implements multi-layer security to protect user data and prevent abuse:

1. **Authentication** - JWT tokens with 30-day expiration
2. **Authorization** - Role-based access (user owns their sessions)
3. **Rate limiting** - Multi-tier limits on API calls and auth attempts
4. **Password security** - bcryptjs hashing with salt
5. **Data protection** - HTTPS enforcement, CORS, CSRF protection
6. **Bot detection** - User-agent filtering and automated request blocking
7. **Input validation** - Type checking, length limits, email validation
8. **Error handling** - Secure error messages (no stack traces in production)

## Authentication Flow

### JWT Token Structure

**Issued by**: `POST /api/auth/login` or `POST /api/auth/verify-otp`

**Token payload** (verified from `backend/auth/token.js`):
```json
{
  "sub": "user-id",
  "email": "user@example.com",
  "name": "User Name",
  "iat": 1694000000,
  "exp": 1696678400
}
```

**Token properties**:
- Algorithm: HS256 (HMAC SHA-256)
- Secret: `JWT_SECRET` environment variable (must be ≥32 characters)
- Expiration: 30 days (`expiresIn: '30d'`)
- Issued at: Current timestamp

**Signing** (in `token.js`):
```javascript
function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, name: user.name },
    config.jwtSecret,  // Must be secret key, not public
    { expiresIn: '30d' }
  );
}
```

### Token Storage & Transmission

**Client-side storage** (in `frontend/public/js/auth.js`):
```javascript
const TOKEN_KEY = 'ai-interviewer:auth';

// Store after login
localStorage.setItem(TOKEN_KEY, token);

// Retrieve for API calls
const token = localStorage.getItem(TOKEN_KEY);

// Clear on logout
localStorage.removeItem(TOKEN_KEY);
```

**Transmission** (HTTP headers):
```javascript
// All API requests include Bearer token
fetch('/api/interview/start', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

**Server verification** (in `middleware.js`):
```javascript
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  
  try {
    const payload = verifyToken(token);  // Throws if invalid/expired
    const user = await User.findById(payload.sub);
    
    if (!user || !user.emailVerified) {
      return res.status(403).json({ error: 'Email not verified.' });
    }
    
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}
```

**Error handling**:
- Missing token: 401 Unauthorized
- Invalid/expired token: 401 Unauthorized (no details leaked)
- User not found: 401 Unauthorized (same response as invalid token)
- Email not verified: 403 Forbidden (clear message for action)

### Optional Authentication

Some endpoints accept tokens but work without them:

```javascript
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
  } catch (err) {
    req.user = null;  // Allow request to continue
  }
  
  next();
}
```

**Used by**: `/api/status` (returns service info to unauthenticated users)

## Password Security

### Hashing Algorithm

**Library**: `bcryptjs` (JavaScript implementation of bcrypt)

**Hash function** (in `backend/auth/passwords.js`):
```javascript
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);  // 10 rounds (2^10 iterations)
  return bcrypt.hash(password, salt);
}

async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}
```

**Properties**:
- Salt rounds: 10 (takes ~100ms per hash)
- Time cost: Makes brute-force attacks impractical
- One-way: Cannot derive plaintext from hash
- Adaptive: Can increase rounds as computers get faster

### Password Validation

**Constraints**:
- Minimum length: 8 characters
- No maximum length (hashed before storage)
- Allowed characters: Any UTF-8

**Validation code** (in `routes/auth.js`):
```javascript
function validateSignup({ name, email, password }) {
  const MIN_PASSWORD_LENGTH = 8;
  
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  
  return { /* valid */ };
}
```

### Password Never Transmitted in Plain Text

- HTTPS enforced (via `NODE_ENV=production` + reverse proxy)
- Passwords hashed immediately on signup/reset
- Password field cleared from request after use
- Reset links expire after 10 minutes
- OTP codes single-use and expire in 10 minutes

## Email Verification

### OTP-Based Verification

**Flow**:
1. User signs up with email
2. Generate 6-digit OTP: `Math.floor(100000 + Math.random() * 900000)`
3. Send OTP via email (or log to console in development)
4. User enters OTP within 10-minute window
5. On verification success: Set `emailVerified = true`, issue token

**OTP properties**:
- Length: 6 digits (1 million possibilities)
- Expiration: 10 minutes
- Single-use: Deleted after verification
- Resendable: User can request new code (rate limited)

**Verification endpoint** (in `routes/auth.js`):
```javascript
router.post('/verify-otp', verifyLimiter, async (req, res) => {
  const { email, code } = req.body;
  
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  
  // Check OTP validity
  if (user.verificationCode !== code) {
    return res.status(400).json({ error: 'Invalid code. Please try again.' });
  }
  
  if (new Date() > user.verificationExpires) {
    return res.status(400).json({ error: 'Code expired. Please request a new one.' });
  }
  
  // Mark verified and issue token
  user.emailVerified = true;
  user.verificationCode = null;
  user.verificationExpires = null;
  await user.save();
  
  const token = signToken(user);
  res.json({ token });
});
```

**Rate limiting** (verified from code):
- Verify attempts: 10 per 15 minutes per IP
- Resend OTP: 5 per 15 minutes per IP

## Authorization & Access Control

### User Ownership

**Principle**: Users can only access their own data

**Implementation**:
- Interview sessions store `userId` on creation
- All session fetches filter by `req.user.id`
- WebSocket connections authenticated with JWT

**Example** (in `routes/interview.js`):
```javascript
router.get('/:id', requireAuth, async (req, res) => {
  const session = await store.getSession(req.params.id);
  
  // Check ownership
  if (session.userId !== req.user.id) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  
  res.json(session);
});
```

### Admin Operations

**None implemented** - No admin interface or special privileges

**Future considerations**:
- Admin flag in User model
- Admin-only endpoints for user management
- Audit logging for admin actions

## Rate Limiting

See [API_ABUSE_PROTECTION.md](API_ABUSE_PROTECTION.md) for the current limits, environment settings, storage behavior, test coverage and deployment requirements.

Limits apply to authenticated users as well as IP addresses. Default account quotas are 10 starts per hour and 200 interview requests per UTC day, with a 30-request/minute account burst limit. A shared MongoDB cap admits at most 1,000 text/JSON Gemini generation invocations per UTC day. Voice has separate daily session quotas, frame/audio limits and a maximum connection duration.

Shared quotas fail closed on database outages in production. Responses use 429 with Retry-After when the quota is exhausted, or 503 when the quota store is unavailable. Short IP and account burst limits remain process-local; daily shared quotas persist in MongoDB. Default trust proxy is false; explicitly configure trusted proxy IPs/CIDRs when needed.

Login now shares the 10-attempt verification limiter, and signup shares the 5-request resend limiter. User-agent filtering is not an authentication or cost-control boundary because clients can change that header.

## Bot Detection & Mitigation

### User-Agent Filtering

**Blocked user agents** (in `index.js`):
```javascript
const scrapers = [
  'python', 'curl', 'wget', 'scrapy', 'postman',
  'headless', 'phantomjs', 'selenium', 'puppeteer',
  'beautifulsoup'
];

app.use((req, res, next) => {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (scrapers.some(bot => ua.includes(bot))) {
    return res.status(403).json({ error: 'Access denied: automated requests are prohibited.' });
  }
  next();
});
```

**Purpose**: Prevent scraping and automated abuse

**Limitations**:
- User-Agent can be spoofed
- Legitimate tools might be blocked
- Allows real browsers through

### Complementary Measures

Combine user-agent filtering with:
1. Rate limiting (catches high-volume attacks)
2. WebSocket authentication (prevents unauthorized live connections)
3. CORS enforcement (prevents browser-based abuse from other domains)
4. Input validation (prevents malformed requests)

## Input Validation

### Email Validation

**Regex** (in `routes/auth.js`):
```javascript
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
```

**Checks**:
- Not empty
- Contains `@` symbol
- Has domain name with TLD
- No spaces

**Limitations**:
- Does not verify email actually exists (checked via OTP)
- Does not validate RFC 5322 strictly (acceptable for UX)

### Password Validation

- Minimum 8 characters
- No character restrictions (allows special chars, unicode)
- Maximum unlimited (hashed before storage)

### Interview Configuration

**Validation** (in `backend/interview/engine.js`):
```javascript
function validateConfig(config) {
  if (!['voice', 'text'].includes(config.mode)) {
    throw new RequestError(400, 'Invalid mode');
  }
  
  if (!['behavioral', 'technical', 'mixed'].includes(config.interviewType)) {
    throw new RequestError(400, 'Invalid interview type');
  }
  
  if (!['beginner', 'intermediate', 'advanced'].includes(config.difficulty)) {
    throw new RequestError(400, 'Invalid difficulty');
  }
  
  const count = parseInt(config.questionCount, 10);
  if (isNaN(count) || count < 1 || count > 30) {
    throw new RequestError(400, 'Question count must be 1-30');
  }
  
  // Validate optional fields
  if (config.resume && config.resume.length > 20000) {
    throw new RequestError(400, 'Resume too long (max 20000 chars)');
  }
  
  return config;
}
```

**Constraints**:
- Mode: enum ['voice', 'text']
- Interview type: enum ['behavioral', 'technical', 'mixed']
- Difficulty: enum ['beginner', 'intermediate', 'advanced']
- Question count: 1-30 (integer)
- Resume/job/company: 0-20000 characters each
- Position: Required, non-empty

## HTTP Security Headers

### Helmet.js Protection

**File**: `backend/index.js`

**Configured headers** (via `helmet()`):
```javascript
app.use(helmet({
  contentSecurityPolicy: false,  // Disabled (allows local/CDN loading)
  crossOriginEmbedderPolicy: false  // Disabled (allows cross-origin resources)
}));
```

**Default headers enabled**:
- `Strict-Transport-Security`: Forces HTTPS
- `X-Content-Type-Options: nosniff`: Prevents MIME sniffing
- `X-Frame-Options: DENY`: Prevents clickjacking (iframe embedding)
- `X-XSS-Protection: 1; mode=block`: Enables browser XSS filter

### CORS Configuration

**Allowed origins** (in `index.js`):
```javascript
app.use(cors({
  origin: config.webUrl,  // e.g., 'https://example.com'
  credentials: true        // Allow cookies/auth headers
}));
```

**Properties**:
- Only `config.webUrl` can access API
- Other domains receive CORS error
- Credentials (JWT in headers) allowed
- Prevents unauthorized cross-domain requests

**Override per route** (example):
```javascript
app.get('/api/status', cors(), (req, res) => {
  // Allow any origin for status endpoint
});
```

## Error Handling

### Secure Error Messages

**In production** (`NODE_ENV=production`):
- Stack traces hidden
- Generic error messages returned
- Details logged server-side only

**Implementation** (in `index.js`):
```javascript
app.use((err, req, res, next) => {
  console.error('Server error:', err);  // Logged
  res.status(500).json({
    error: err.message || 'Internal server error',
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
});
```

### Validation Error Messages

**Specific errors** (for user input):
- "Invalid email address"
- "Password must be at least 8 characters"
- "Question count must be 1-30"

**Generic errors** (for system failures):
- "The AI interviewer is temporarily unavailable"
- "Could not load your history"

**Rule**: Validation errors → specific (helps users fix); system errors → generic (prevents info leakage)

## WebSocket Security

The upgrade handler verifies the JWT, the account's existence and email verification, and ownership/eligibility of the interview before opening a voice provider connection. A supplied Origin must equal WEB_URL. Daily account and global voice reservations happen before provider startup.

A worker admits only one pending/active voice connection per account. Inbound frames are limited to 64 KiB, 100 messages and 128 KiB per second. Audio must be valid base64 for 16 kHz PCM and cannot exceed the configured session audio budget. Text is length- and pace-limited. Pre-ready audio is dropped, and upstream streaming stops on invalid traffic, duration expiry or completion.

These controls are separate from Express HTTP middleware. See [API_ABUSE_PROTECTION.md](API_ABUSE_PROTECTION.md) for the process-local concurrency limitation and shared quota guarantees.

## Environment Security

### Sensitive Configuration

**Must be set** (or app degrades gracefully):
- `JWT_SECRET` - Secret key for signing tokens (≥32 chars, random)
- `GEMINI_API_KEY` - Google Gemini API key
- `MONGO_URI` - MongoDB connection string (required for shared production AI quotas).

**Handling**:
- Never hardcode in source code
- Load from environment variables only
- Validate at startup
- Fail with clear errors if missing

**Example** (in `backend/config.js`):
```javascript
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be ≥32 characters');
}
```

### Development vs Production

**Development** (NODE_ENV !== 'production'):
- OTP codes printed to console (for testing)
- Stack traces visible in API responses
- CORS uses the configured WEB_URL.
- Rate limits remain active; development without a Mongo URI may use process-local quota counters.

**Production** (NODE_ENV === 'production'):
- OTP codes sent via email only
- Stack traces hidden
- CORS enforced to specific domain
- Rate limits enforced
- HTTPS required (enforce via reverse proxy)

## Best Practices & Recommendations

### For Developers

1. **Never log sensitive data**:
   ```javascript
   // Bad: logs password
   console.log('User login:', { email, password });
   
   // Good: only log necessary info
   console.log('User login:', { email });
   ```

2. **Validate all inputs**:
   ```javascript
   // Validate before use, even from frontend
   if (typeof count !== 'number' || count < 1 || count > 30) {
     throw new RequestError(400, 'Invalid count');
   }
   ```

3. **Use parameterized queries** (if extending with SQL):
   ```javascript
   // Bad: SQL injection risk
   db.query(`SELECT * FROM users WHERE email = '${email}'`);
   
   // Good: parameterized
   db.query('SELECT * FROM users WHERE email = ?', [email]);
   ```

4. **Fail securely**:
   ```javascript
   // Bad: reveals whether email exists
   if (user not found) {
     return 'User with this email not registered'
   }
   
   // Good: generic response
   if (user not found) {
     return 'Invalid credentials'  // Same as wrong password
   }
   ```

### For Operators

1. **Rotate JWT_SECRET regularly** (quarterly or after security review)
   ```bash
   # Generate new secret
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   
   # Update .env and restart
   ```

2. **Monitor rate limit hits**:
   ```bash
   # Look for patterns in logs
   grep "Too many requests" /var/log/app.log | wc -l
   
   # If high: investigate source IP, may indicate attack
   ```

3. **Enforce HTTPS**:
   ```nginx
   # nginx reverse proxy
   server {
     listen 80;
     return 301 https://$server_name$request_uri;
   }
   ```

4. **Regular backups** (for MongoDB):
   ```bash
   # Automated daily backup
   mongodump --uri="mongodb://..." --archive=/backups/db-$(date +%Y%m%d).archive
   ```

5. **Security updates**:
   ```bash
   # Keep dependencies current
   npm audit
   npm update  # Or npm audit fix --force
   ```

### For Users

1. **Use strong passwords**: ≥12 characters, mix of cases, numbers, symbols
2. **Don't share tokens**: Never paste JWT in chat, email, or public forums
3. **Clear browser cache** before leaving shared computers
4. **Enable browser security**: Keep browser updated, use security extensions
5. **Report security issues**: Contact maintainer (don't post publicly)

## Security Testing Checklist

- [ ] Test missing JWT token → 401 Unauthorized
- [ ] Test expired JWT token → 401 Unauthorized
- [ ] Test JWT with modified payload → 401 Unauthorized
- [ ] Test accessing other user's session → 403 Forbidden
- [ ] Test OTP brute-force (11+ attempts) → Rate limited
- [ ] Test simultaneous signups with same email → Only one succeeds
- [ ] Test invalid email format → 400 Bad Request
- [ ] Test password < 8 chars → 400 Bad Request
- [ ] Test invalid interview config → 400 Bad Request
- [ ] Test 101+ API calls in 15 min → 429 Too Many Requests
- [ ] Test scrapy user-agent → 403 Forbidden
- [ ] Test CORS from different origin → Request rejected
- [ ] Test WebSocket without token → Connection rejected
- [ ] Test WebSocket with invalid token → Connection rejected

---

**See also**:
- [SETUP.md](./SETUP.md#environment-variables) - Environment configuration
- [API.md](./API.md#error-responses) - API error handling
- [BACKEND.md](./BACKEND.md#authentication-middleware) - Auth middleware details
