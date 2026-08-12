import { serializeSseFrame } from '@forge/ai';

/**
 * SSE transport for the Copilot stream (plan §10.2).
 *
 * Matches Agentforge's wire contract (text/event-stream + `data: {...}\n\n`
 * frames + a `data: [DONE]\n\n` terminator) so the legacy frontend renderer
 * keeps working unchanged. Adds a keep-alive heartbeat (comment frames, which
 * EventSource ignores) so proxies don't drop idle streams.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {{
 *   send: (envelope: object) => void,
 *   done: () => void,
 *   fail: (content: string) => void,
 *   onClose: (cb: () => void) => void,
 * }}
 */
export function setupSse(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // prevent proxy buffering (Render/Nginx)
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': keep-alive\n\n');
  }, 15_000);
  const teardown = () => clearInterval(heartbeat);

  return {
    send(envelope) {
      if (!res.writableEnded) res.write(serializeSseFrame(envelope));
    },
    done() {
      if (!res.writableEnded) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
      teardown();
    },
    fail(content) {
      if (!res.writableEnded) {
        res.write(serializeSseFrame({ type: 'error', content }));
        res.write('data: [DONE]\n\n');
        res.end();
      }
      teardown();
    },
    onClose(cb) {
      req.on('close', () => {
        teardown();
        cb?.();
      });
    },
  };
}
