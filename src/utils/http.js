/**
 * HTTP Utilities
 */

/**
 * Parse JSON request body with size limit
 * @param {object} req - HTTP request object
 * @param {number} maxSize - Maximum body size in bytes (default: 1MB)
 * @returns {Promise<object>} Parsed JSON object
 */
export function parseBody(req, maxSize = 1048576) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });

    req.on('error', reject);
  });
}
