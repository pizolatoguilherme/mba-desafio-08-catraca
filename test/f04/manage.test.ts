import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import { describe, expect, it } from 'vitest';

const VIEWS = fileURLToPath(new URL('../../src/views/', import.meta.url));

describe('F04 página de gestão', () => {
  it('C-F04-19 os partials dos slots existem e não renderizam nada', async () => {
    for (const p of ['purchases/_buy', 'checkin/_panel', 'checkin/_checkin', 'cancel/_cancel']) {
      const html = await ejs.renderFile(`${VIEWS}${p}.ejs`, { event: {}, seats: {}, user: null });
      expect(html.trim(), p).toBe('');
    }
  });
});
