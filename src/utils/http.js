/**
 * HTTP Utilities
 */

function clientError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Parse JSON request body with size limit.
 *
 * A body over `maxSize` rejects with `statusCode` 413, a body that is not
 * valid JSON with `statusCode` 400, so callers can answer with that status
 * instead of blaming an upstream. A request stream error is passed through
 * without a `statusCode`.
 *
 * @param {object} req - HTTP request object
 * @param {number} maxSize - Maximum body size in bytes (default: 1MB)
 * @returns {Promise<object>} Parsed JSON object
 */
export function parseBody(req, maxSize = 1048576) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', data => {
      if (tooLarge) return;
      const chunk = typeof data === 'string' ? Buffer.from(data) : data;
      size += chunk.length;
      if (size > maxSize) {
        tooLarge = true;
        reject(clientError(413, 'Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge) return;
      // Decode once at the end so a multi-byte character split across
      // chunks is not mangled.
      const body = Buffer.concat(chunks).toString('utf8');
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(clientError(400, `Request body is not valid JSON: ${err.message}`));
      }
    });

    req.on('error', reject);
  });
}
