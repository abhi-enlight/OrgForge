import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

export const streamLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 30, // Limit each IP to 30 requests per windowMs for SSE streams
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many stream requests, please try again later.' }
});

// OAuth/auth endpoints are unauthenticated entry points — a prime brute-force
// and replay target. Keep the limit tight.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication requests, please try again later.' }
});

// AI generation endpoints consume billed LLM tokens — bound consumption so a
// crafted or noisy caller cannot run up cost (OWASP LLM10: Unbounded
// Consumption).
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many AI requests, please try again later.' }
});
