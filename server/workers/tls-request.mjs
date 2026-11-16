import { Agent, request } from 'node:https';

// The host and port are fixed by trusted bootstrap. Redirects and caller-supplied
// TLS verification overrides are not supported.
export function tlsRequester(origin, tls) {
  if (!/^https:\/\/127\.0\.0\.1:\d+$/.test(origin) || !tls ||
      Object.keys(tls).sort().join(',') !== 'ca,cert,key' ||
      ![tls.key, tls.cert, tls.ca].every(v => (typeof v === 'string' || Buffer.isBuffer(v)) && v.length))
    throw Error('Pinned mutual TLS transport required');
  const agent = new Agent({ key: tls.key, cert: tls.cert, ca: tls.ca,
    rejectUnauthorized: true, minVersion: 'TLSv1.3', keepAlive: true, maxSockets: 4 });
  return {
    close: () => agent.destroy(),
    async call(path, token, body, signal) {
      if (!/^\/v1\/jobs(?:\/[a-zA-Z0-9_.:/-]+)?$/.test(path) || path.includes('..') || path.includes('//')) throw Error('Invalid worker path');
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      return new Promise((resolve, reject) => {
        const req = request(origin + path, { agent, signal, method: bytes ? 'POST' : 'GET', timeout: 10_000,
          headers: { authorization: `Bearer ${token}`, ...(bytes ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}) } }, res => {
          const chunks = []; let size = 0;
          res.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) res.destroy(Error('Worker response too large')); else chunks.push(chunk); });
          res.on('error', reject);
          res.on('end', () => {
            if (res.statusCode < 200 || res.statusCode >= 300) return reject(Error(`Worker operation rejected (${res.statusCode})`));
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Error('Invalid worker response')); }
          });
        });
        req.on('timeout', () => req.destroy(Error('Worker request timed out')));
        req.on('error', reject); req.end(bytes);
      });
    },
  };
}
