/**
 * Test double for the `playwright` peer dependency (loaded through
 * HARNESS_PLAYWRIGHT_MODULE). Writes deterministic files instead of
 * driving a browser:
 *   route contains "blank" -> a valid PNG header but tiny (a blank page)
 *   route contains "html"  -> large, but not a PNG
 *   route contains "boom"  -> navigation throws
 *   anything else          -> a large PNG-signed file
 */
import { writeFileSync } from 'node:fs';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const chromium = {
  async launch() {
    let current = '';
    return {
      async newPage() {
        return {
          async goto(url) {
            if (url.includes('boom')) throw new Error(`net::ERR_CONNECTION_REFUSED at ${url}`);
            current = url;
          },
          async waitForSelector() {},
          async screenshot({ path }) {
            if (current.includes('blank')) writeFileSync(path, Buffer.concat([SIG, Buffer.alloc(200)]));
            else if (current.includes('html')) writeFileSync(path, Buffer.from('<html>'.padEnd(5000, ' ')));
            else writeFileSync(path, Buffer.concat([SIG, Buffer.alloc(6000, 7)]));
          },
        };
      },
      async close() {},
    };
  },
};
