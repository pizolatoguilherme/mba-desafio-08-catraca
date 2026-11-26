#!/usr/bin/env node
// F08: Fluxo do avaliador (docs/brief.md, passos 2–16) contra o produto no ar.
// Node 22 puro, sem dependências (roda na máquina do avaliador sem npm install).
//
//   npm run flow                       # WEB/API = http://localhost:${CATRACA_PORT:-3000}, escala 1
//   WEB=… API=… KEY=… npm run flow
//
// Cada execução usa nomes e e-mails únicos (runId): pode rodar várias vezes contra o mesmo banco.
// Esperas por condição usam polling com prazo; as únicas esperas fixas são as mínimas do brief
// ("passados 45 segundos"). Primeira falha -> "FAIL passo N — esperado / obtido" e exit 1.
import { pathToFileURL } from 'node:url';

const SEED = {
  orgA: 'org.a@catraca.dev',
  orgB: 'org.b@catraca.dev',
  participant: 'participante@catraca.dev',
  password: 'catraca123',
};
const CARD = {
  c0001: '4000000000000001',
  c0003: '4000000000000003',
  c0004: '4000000000000004',
};
const VENUE = 'Porão do Fluxo';
const PANEL_KEYS = ['confirmed', 'pending', 'checkins', 'available', 'revenue', 'refunded'];

class StepError extends Error {
  constructor(expected, got) {
    super(`esperado: ${expected} / obtido: ${got}`);
    this.expected = expected;
    this.got = got;
  }
}

function fail(expected, got) {
  throw new StepError(expected, got);
}

function check(cond, expected, got) {
  if (!cond) fail(expected, typeof got === 'function' ? got() : got);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const short = (s, n = 160) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// ---------------------------------------------------------------------------------------------
// HTTP: sessão com cookie jar manual (Set-Cookie via getSetCookie), sem seguir redirects.

class Session {
  constructor(base, name) {
    this.base = base;
    this.name = name;
    this.jar = new Map();
  }

  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  has(name) {
    return this.jar.has(name);
  }

  async req(method, path, { form } = {}) {
    const headers = {};
    if (this.jar.size) headers.cookie = this.cookieHeader();
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(this.base + path, { method, headers, body, redirect: 'manual' });
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(';');
      const i = pair.indexOf('=');
      if (i < 1) continue;
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a)) || v === '';
      if (expired) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), body: text };
  }

  get(path) {
    return this.req('GET', path);
  }

  post(path, form = {}) {
    return this.req('POST', path, { form });
  }
}

// ---------------------------------------------------------------------------------------------
// Extratores de HTML (convenções do architecture.md e das specs de F04/F05/F07).

/** Linhas de "Meus ingressos": a tag com data-ticket-code e data-ticket-status, e o texto até </tr>. */
function ticketRows(html) {
  const rows = [];
  const re = /<[^>]*data-ticket-code="([^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const status = (tag.match(/data-ticket-status="([^"]*)"/) || [])[1] ?? null;
    const end = html.indexOf('</tr>', m.index);
    const row = html.slice(m.index, end === -1 ? m.index + 600 : end);
    rows.push({ code: m[1], status, text: row.replace(/<[^>]*>/g, ' ') });
  }
  return rows;
}

function metrics(html) {
  const out = {};
  for (const k of PANEL_KEYS) {
    const m = html.match(new RegExp(`data-metric="${k}"[^>]*>([^<]*)<`));
    out[k] = m ? m[1].trim() : null;
  }
  return out;
}

function checkinResult(html) {
  const m = html.match(/data-checkin-result[^>]*>([^<]*)</);
  return m ? m[1].trim() : null;
}

function inputValue(html, name) {
  const tag = (html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`)) || [])[0];
  if (!tag) return null;
  return (tag.match(/value="([^"]*)"/) || [])[1] ?? null;
}

function hasFormAction(html, action) {
  const esc = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<form[^>]*action="${esc}"`).test(html);
}

function panelString(p) {
  return PANEL_KEYS.map((k) => `${k}=${p[k] ?? '<ausente>'}`).join(' | ');
}

// ---------------------------------------------------------------------------------------------
// Datas (America/Sao_Paulo, formato datetime-local).

function localDate(offsetDays) {
  return new Date(Date.now() + offsetDays * 864e5).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) + 'T21:00';
}

// ---------------------------------------------------------------------------------------------

/**
 * Executa os passos 2–16 do Fluxo do avaliador. Devolve { ok: true, steps } ou
 * { ok: false, step, error, steps }. Nunca lança (erro inesperado vira falha do passo corrente).
 */
export async function runFlow(opts) {
  const web = String(opts.web).replace(/\/+$/, '');
  const apiBase = String(opts.api ?? opts.web).replace(/\/+$/, '');
  const key = opts.key;
  const scale = opts.scale ?? 1;
  const log = opts.log ?? ((line) => console.log(line));
  const slack = scale < 1 ? 1000 : 0;
  /** Prazo superior do brief ("em até N s"). */
  const within = (ms) => ms * scale + slack;
  /** Espera mínima do brief ("passados N s"). */
  const after = (ms) => ms * scale + slack;
  /** Janela "antes de N s". */
  const before = (ms) => ms * scale;
  const pollEvery = scale < 1 ? 50 : 250;
  const runId = Date.now().toString(36);
  const steps = [];
  const t0 = Date.now();

  /** Polling até fn() devolver { ok: true, value } ou o prazo absoluto `deadline` passar. */
  // Uma tentativa só conta se COMEÇOU até o prazo; a última é agendada um pouco antes dele.
  async function poll(fn, deadline, expected) {
    const started = Date.now();
    let got = 'nenhuma tentativa';
    for (;;) {
      if (Date.now() > deadline) {
        fail(`${expected} dentro do prazo`, `${got} após ${((Date.now() - started) / 1000).toFixed(1)} s de espera`);
      }
      const r = await fn();
      if (r.ok) return r.value;
      got = r.got;
      const left = deadline - Date.now();
      await sleep(left > pollEvery + 30 ? pollEvery : Math.max(0, left - 30));
      if (left <= 0) {
        fail(`${expected} dentro do prazo`, `${got} após ${((Date.now() - started) / 1000).toFixed(1)} s de espera`);
      }
    }
  }

  async function api(method, path, { body, apiKey = key, raw } = {}) {
    const headers = {};
    if (apiKey !== null) headers['x-api-key'] = apiKey;
    let payload;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = raw ? body : JSON.stringify(body);
    }
    const res = await fetch(apiBase + path, { method, headers, body: payload, redirect: 'manual' });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, text, json };
  }

  async function apiEvents() {
    const r = await api('GET', '/api/partner/events');
    check(r.status === 200 && Array.isArray(r.json), 'GET /api/partner/events → 200 com array', `${r.status} ${short(r.text)}`);
    return r.json;
  }

  async function apiEvent(id) {
    return (await apiEvents()).find((e) => e.id === id);
  }

  async function apiTicket(id) {
    const r = await api('GET', `/api/partner/tickets/${id}`);
    check(r.status === 200 && r.json, `GET /api/partner/tickets/${id} → 200`, `${r.status} ${short(r.text)}`);
    return r.json;
  }

  async function apiBuy(eventId, email, card) {
    return api('POST', `/api/partner/events/${eventId}/purchases`, { body: { buyerEmail: email, cardNumber: card } });
  }

  function expectJson(r, status, body, what) {
    const ok = r.status === status && r.json !== undefined && JSON.stringify(r.json) === JSON.stringify(body);
    check(ok, `${what} → ${status} ${JSON.stringify(body)}`, `${r.status} ${short(r.text)}`);
  }

  async function login(email) {
    const s = new Session(web, email);
    const r = await s.post('/login', { email, password: SEED.password });
    check(r.status === 303 && s.has('sid'), `login de ${email} → 303 com cookie sid`, `${r.status} sid=${s.has('sid')}`);
    return s;
  }

  async function createEvent(s, { name, capacity, price, startsAt = localDate(30), venue = VENUE }) {
    const r = await s.post('/org/events/new', { name, venue, startsAt, capacity: String(capacity), price });
    let id = (r.location || '').match(/\/org\/events\/(evt_[a-z0-9]+)/)?.[1];
    if (!id && r.status < 500) {
      // Fallback: link do nome único na lista do organizador.
      const list = await s.get('/org/events');
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      id = list.body.match(new RegExp(`/org/events/(evt_[a-z0-9]+)"[^>]*>${esc}<`))?.[1];
    }
    return { status: r.status, id };
  }

  async function createOk(s, ev) {
    const r = await createEvent(s, ev);
    check(r.status === 303 && r.id, `criação de "${ev.name}" → 303 com id evt_…`, `${r.status} id=${r.id}`);
    return r.id;
  }

  async function publish(s, id) {
    const r = await s.post(`/org/events/${id}/publish`);
    check(r.status === 303, `publicação de ${id} → 303`, `${r.status} ${short(r.body)}`);
  }

  function editFields(name, capacity, price) {
    return { name, venue: VENUE, startsAt: localDate(30), capacity: String(capacity), price };
  }

  async function panel(s, id) {
    const r = await s.get(`/org/events/${id}`);
    check(r.status === 200, `GET /org/events/${id} → 200`, r.status);
    return metrics(r.body);
  }

  async function expectPanel(s, id, want) {
    const got = await panel(s, id);
    check(
      PANEL_KEYS.every((k) => got[k] === want[k]),
      `painel ${panelString(want)}`,
      panelString(got),
    );
  }

  async function checkin(s, id, code) {
    const r = await s.post(`/org/events/${id}/checkin`, { code });
    check(r.status === 200, `check-in em ${id} → 200`, r.status);
    return { result: checkinResult(r.body), body: r.body };
  }

  async function expectCheckin(s, id, code, want) {
    const { result } = await checkin(s, id, code);
    check(result === want, `check-in de ${code} → "${want}"`, `"${result}"`);
  }

  async function waitTicket(id, status, deadline) {
    return poll(
      async () => {
        const t = await apiTicket(id);
        return { ok: t.status === status, value: t, got: `status ${t.status}` };
      },
      deadline,
      `ticket ${id} com status ${status}`,
    );
  }

  async function waitUntil(ts) {
    await sleep(ts - Date.now());
  }

  // Estado compartilhado entre os passos.
  const S = {};
  const names = {
    e1: `E1 Fluxo ${runId}`,
    yesterday: `Ontem Fluxo ${runId}`,
    e2: `E2 Fluxo ${runId}`,
    e3: `E3 Fluxo ${runId}`,
    e4: `E4 Fluxo ${runId}`,
    e5: `E5 Fluxo ${runId}`,
    edited: `Editado ${runId}`,
  };
  const visitor = new Session(web, 'visitante');

  const STEPS = [
    [2, 'E1 em rascunho fora da vitrine e da API', async () => {
      S.a = await login(SEED.orgA);
      S.e1 = await createOk(S.a, { name: names.e1, capacity: 2, price: '100,00' });
      check(/^evt_[a-z0-9]+$/.test(S.e1), 'id de E1 no formato evt_…', S.e1);
      const home = await visitor.get('/');
      check(home.status === 200, 'GET / → 200', home.status);
      check(!home.body.includes(names.e1) && !home.body.includes(S.e1), 'vitrine sem E1 (rascunho)', 'E1 aparece na vitrine');
      const list = await apiEvents();
      check(!list.some((e) => e.id === S.e1), 'listagem da API sem E1 (rascunho)', 'E1 aparece na API');
    }],

    [3, 'criação com data de ontem rejeitada', async () => {
      const r = await createEvent(S.a, { name: names.yesterday, capacity: 2, price: '100,00', startsAt: localDate(-1) });
      check(r.status < 500, 'criação com data de ontem → status não 5xx', r.status);
      const list = await S.a.get('/org/events');
      check(!list.body.includes(names.yesterday), `"${names.yesterday}" ausente de /org/events`, `evento criado (status ${r.status})`);
    }],

    [4, 'E1 publicado na vitrine e na API (availableSeats 2, priceCents 10000)', async () => {
      await publish(S.a, S.e1);
      const home = await visitor.get('/');
      check(home.body.includes(names.e1) && home.body.includes(`/events/${S.e1}`), `vitrine com "${names.e1}" e /events/${S.e1}`, 'E1 ausente da vitrine');
      const e = await apiEvent(S.e1);
      check(e, 'E1 na listagem da API', 'ausente');
      const keys = Object.keys(e).sort().join(',');
      check(keys === 'availableSeats,id,name,priceCents,startsAt', 'chaves id,name,startsAt,priceCents,availableSeats', keys);
      check(e.availableSeats === 2 && e.priceCents === 10000, 'availableSeats 2 e priceCents 10000', JSON.stringify(e));
    }],

    [5, 'participante novo compra na vitrine: pendente → confirmado em ≤ 5 s', async () => {
      S.p = new Session(web, 'participante novo');
      const email = `p-${runId}@example.com`;
      const su = await S.p.post('/signup', { name: `Participante ${runId}`, email, password: SEED.password });
      check(su.status === 303 && S.p.has('sid'), 'cadastro → 303 com cookie sid', `${su.status} sid=${S.p.has('sid')}`);
      const t5 = Date.now();
      const buy = await S.p.post(`/events/${S.e1}/purchase`, { cardNumber: CARD.c0001 });
      check(buy.status === 303 && buy.location === '/me/tickets', 'compra na vitrine → 303 /me/tickets', `${buy.status} ${buy.location}`);
      const first = await S.p.get('/me/tickets');
      const rows = ticketRows(first.body);
      check(rows.length === 1, '1 linha em Meus ingressos', `${rows.length} linhas`);
      check(rows[0].status === 'pending' && rows[0].text.includes('pendente'), 'linha pending com "pendente"', `${rows[0].status} "${short(rows[0].text, 80)}"`);
      const deadline = t5 + within(5000);
      const confirmed = await poll(
        async () => {
          const r = await S.p.get('/me/tickets');
          const [row] = ticketRows(r.body);
          const ok = row && row.status === 'confirmed' && row.text.includes('confirmado') && r.body.includes(names.e1);
          return { ok, value: row, got: row ? `${row.status} "${short(row.text, 80)}"` : 'sem linha' };
        },
        deadline,
        `linha confirmed com "confirmado" e o nome de E1 em ≤ ${within(5000) / 1000} s`,
      );
      S.c1 = confirmed.code;
      check(/^[A-Z2-9]{8}$/.test(S.c1), 'código C1 com 8 caracteres [A-Z2-9]', S.c1);
    }],

    [6, 'compra pela API com 0004: 202 pending e availableSeats 0', async () => {
      S.t6 = Date.now();
      const r = await apiBuy(S.e1, `t2-${runId}@example.com`, CARD.c0004);
      check(r.status === 202 && r.json, 'compra → 202', `${r.status} ${short(r.text)}`);
      const keys = Object.keys(r.json).sort().join(',');
      check(keys === 'code,status,ticketId', 'chaves ticketId,code,status', keys);
      check(r.json.status === 'pending', 'status "pending"', r.json.status);
      S.T2 = r.json.ticketId;
      S.c2 = r.json.code;
      const e = await apiEvent(S.e1);
      check(e && e.availableSeats === 0, 'E1 com availableSeats 0', JSON.stringify(e));
    }],

    [7, 'sem vaga: API 409 sold_out e vitrine "Ingressos esgotados" antes de 30 s', async () => {
      const r = await apiBuy(S.e1, `esgotado-${runId}@example.com`, CARD.c0001);
      expectJson(r, 409, { error: 'sold_out' }, 'compra de E1 esgotado');
      const page = await S.p.get(`/events/${S.e1}`);
      check(page.status === 200 && page.body.includes('Ingressos esgotados'), 'página de E1 com "Ingressos esgotados"', `${page.status} ${short(page.body)}`);
      const elapsed = Date.now() - S.t6;
      check(elapsed < before(30000), `antes de ${before(30000) / 1000} s do passo 6`, `${(elapsed / 1000).toFixed(1)} s`);
    }],

    [8, 'passados 45 s: T2 declined, availableSeats 1 e T3 confirmado em ≤ 5 s', async () => {
      await waitUntil(S.t6 + after(45000));
      const t2 = await apiTicket(S.T2);
      check(t2.status === 'declined', 'T2 com status declined', t2.status);
      const e = await apiEvent(S.e1);
      check(e && e.availableSeats === 1, 'E1 com availableSeats 1', JSON.stringify(e));
      const t8 = Date.now();
      const r = await apiBuy(S.e1, `t3-${runId}@example.com`, CARD.c0001);
      check(r.status === 202 && r.json, 'compra de T3 → 202', `${r.status} ${short(r.text)}`);
      S.T3 = r.json.ticketId;
      await waitTicket(S.T3, 'confirmed', t8 + within(5000));
    }],

    [9, 'edição: lotação 1 rejeitada; preço 150,00 e lotação 3 aceitos; painel 3/0/0/0/R$ 350,00/0', async () => {
      const r1 = await S.a.post(`/org/events/${S.e1}`, editFields(names.e1, 1, '100,00'));
      check(r1.status < 500, 'edição para lotação 1 → status não 5xx', r1.status);
      let page = await S.a.get(`/org/events/${S.e1}`);
      check(inputValue(page.body, 'capacity') === '2', 'campo capacity com valor 2 (edição rejeitada)', inputValue(page.body, 'capacity'));
      let e = await apiEvent(S.e1);
      check(e && e.priceCents === 10000 && e.availableSeats === 0, 'API: priceCents 10000 e availableSeats 0', JSON.stringify(e));

      const r2 = await S.a.post(`/org/events/${S.e1}`, editFields(names.e1, 3, '150,00'));
      check(r2.status < 500, 'edição para 150,00 e lotação 3 → status não 5xx', r2.status);
      page = await S.a.get(`/org/events/${S.e1}`);
      check(inputValue(page.body, 'capacity') === '3', 'campo capacity com valor 3', inputValue(page.body, 'capacity'));
      e = await apiEvent(S.e1);
      check(e && e.priceCents === 15000 && e.availableSeats === 1, 'API: priceCents 15000 e availableSeats 1', JSON.stringify(e));

      const t = Date.now();
      const r = await apiBuy(S.e1, `t4-${runId}@example.com`, CARD.c0001);
      check(r.status === 202 && r.json, 'compra de T4 → 202', `${r.status} ${short(r.text)}`);
      S.T4 = r.json.ticketId;
      await waitTicket(S.T4, 'confirmed', t + within(5000));
      await expectPanel(S.a, S.e1, { confirmed: '3', pending: '0', checkins: '0', available: '0', revenue: 'R$ 350,00', refunded: '0' });
    }],

    [10, 'check-in de E1: as 4 mensagens de R10 e Check-ins 1', async () => {
      await expectCheckin(S.a, S.e1, S.c1, 'Entrada liberada');
      await expectCheckin(S.a, S.e1, S.c1, 'Ingresso já utilizado');
      await expectCheckin(S.a, S.e1, S.c2, 'Ingresso não confirmado');
      await expectCheckin(S.a, S.e1, 'ZZZZZZZZ', 'Ingresso inválido para este evento');
      const p = await panel(S.a, S.e1);
      check(p.checkins === '1', 'painel com checkins=1', panelString(p));
      S.manageUrl = `${web}/org/events/${S.e1}`;
      S.managePath = `/org/events/${S.e1}`;
    }],

    [11, 'isolamento: org B, participante e visitante não veem E1; C3 inválido em E1', async () => {
      const secrets = [names.e1, VENUE, S.c1, S.c2, 'data-metric', 'data-checkin-result'];
      const leaks = (body) => secrets.filter((s) => body.includes(s));
      const b = await login(SEED.orgB);
      const list = await b.get('/org/events');
      check(list.status === 200, 'GET /org/events de B → 200', list.status);
      check(!list.body.includes(names.e1) && !list.body.includes(S.e1), 'lista de B sem E1', 'E1 aparece na lista de B');
      const rb = await b.get(S.managePath);
      check(rb.status === 404, `${S.manageUrl} para B → 404`, rb.status);
      check(leaks(rb.body).length === 0, 'corpo sem dados de E1 (B)', leaks(rb.body).join(', '));

      const e2 = await createEvent(b, { name: names.e2, capacity: 1, price: '20,00', venue: 'Palco do B' });
      check(e2.status === 303 && e2.id, `criação de "${names.e2}" → 303`, `${e2.status}`);
      await publish(b, e2.id);
      const fromApi = (await apiEvents()).find((e) => e.name === names.e2);
      check(fromApi, `E2 "${names.e2}" na listagem da API`, 'ausente');
      const buy = await apiBuy(fromApi.id, `c3-${runId}@example.com`, CARD.c0001);
      check(buy.status === 202 && buy.json, 'compra de E2 → 202', `${buy.status} ${short(buy.text)}`);
      S.c3 = buy.json.code;

      const s = await login(SEED.participant);
      const rs = await s.get(S.managePath);
      check(rs.status === 403, `${S.manageUrl} para o participante → 403`, rs.status);
      check(leaks(rs.body).length === 0, 'corpo sem dados de E1 (participante)', leaks(rs.body).join(', '));
      const rv = await visitor.get(S.managePath);
      check(rv.status === 302 && (rv.location || '').startsWith('/login'), `${S.manageUrl} para o visitante → 302 /login…`, `${rv.status} ${rv.location}`);
      check(leaks(rv.body).length === 0, 'corpo sem dados de E1 (visitante)', leaks(rv.body).join(', '));

      await expectCheckin(S.a, S.e1, S.c3, 'Ingresso inválido para este evento');
    }],

    [12, 'E3: T5 (0003) pendente, T6 confirmado e cancelamento antes de 30 s', async () => {
      S.e3 = await createOk(S.a, { name: names.e3, capacity: 5, price: '50,00' });
      await publish(S.a, S.e3);
      const page = await S.a.get(`/org/events/${S.e3}`);
      check(page.status === 200 && page.body.includes('Cancelar evento'), 'gestão de E3 com "Cancelar evento"', `${page.status}`);
      S.t12 = Date.now();
      const r5 = await apiBuy(S.e3, `t5-${runId}@example.com`, CARD.c0003);
      check(r5.status === 202 && r5.json, 'compra de T5 → 202', `${r5.status} ${short(r5.text)}`);
      S.T5 = r5.json.ticketId;
      const t = Date.now();
      const r6 = await apiBuy(S.e3, `t6-${runId}@example.com`, CARD.c0001);
      check(r6.status === 202 && r6.json, 'compra de T6 → 202', `${r6.status} ${short(r6.text)}`);
      S.T6 = r6.json.ticketId;
      S.c6 = r6.json.code;
      await waitTicket(S.T6, 'confirmed', t + within(5000));
      const t5 = await apiTicket(S.T5);
      check(t5.status === 'pending', 'T5 ainda pending antes do cancelamento', t5.status);
      const c = await S.a.post(`/org/events/${S.e3}/cancel`);
      S.tc = Date.now();
      check(c.status === 303 && c.location === `/org/events/${S.e3}`, `cancelamento → 303 /org/events/${S.e3}`, `${c.status} ${c.location}`);
      const elapsed = S.tc - S.t12;
      check(elapsed < before(30000), `cancelado antes de ${before(30000) / 1000} s da compra de T5`, `${(elapsed / 1000).toFixed(1)} s`);
    }],

    [13, 'E3 cancelado: fora da vitrine e da API, 404 event_not_available, refunded/cancelled em ≤ 10 s, sem edição', async () => {
      const home = await visitor.get('/');
      check(!home.body.includes(names.e3) && !home.body.includes(S.e3), 'vitrine sem E3', 'E3 aparece na vitrine');
      const list = await apiEvents();
      check(!list.some((e) => e.id === S.e3), 'listagem da API sem E3', 'E3 aparece na API');
      const r = await apiBuy(S.e3, `pos-cancel-${runId}@example.com`, CARD.c0001);
      expectJson(r, 404, { error: 'event_not_available' }, 'compra de E3 cancelado');
      const deadline = S.tc + within(10000);
      await waitTicket(S.T6, 'refunded', deadline);
      await waitTicket(S.T5, 'cancelled', deadline);

      const page = await S.a.get(`/org/events/${S.e3}`);
      check(page.status === 200, 'gestão de E3 → 200', page.status);
      check(!/<input[^>]*name="capacity"/.test(page.body), 'gestão de E3 sem campo capacity', 'campo capacity presente');
      check(!hasFormAction(page.body, `/org/events/${S.e3}/publish`), 'gestão de E3 sem form de publicação', 'form de publicação presente');
      check(!page.body.includes('Cancelar evento'), 'gestão de E3 sem "Cancelar evento"', '"Cancelar evento" presente');
      const ed = await S.a.post(`/org/events/${S.e3}`, editFields(names.edited, 5, '50,00'));
      check(ed.status < 500, 'tentativa de edição → status não 5xx', ed.status);
      const again = await S.a.get(`/org/events/${S.e3}`);
      check(!again.body.includes(names.edited) && again.body.includes(names.e3), `nome continua "${names.e3}"`, 'nome alterado');
    }],

    [14, 'passados 45 s: T5 cancelled, check-in "Evento cancelado" e painel 0/0/0/0/R$ 0,00/1', async () => {
      await waitUntil(S.t12 + after(45000));
      const t5 = await apiTicket(S.T5);
      check(t5.status === 'cancelled', 'T5 continua cancelled', t5.status);
      const t6 = await apiTicket(S.T6);
      check(t6.status === 'refunded', 'T6 continua refunded', t6.status);
      const { result, body } = await checkin(S.a, S.e3, S.c6);
      if (result !== null) check(result === 'Evento cancelado', 'check-in de C6 → "Evento cancelado"', `"${result}"`);
      else check(body.includes('Evento cancelado') && !body.includes('Entrada liberada'), '"Evento cancelado" no lugar do campo', 'mensagem ausente');
      await expectPanel(S.a, S.e3, { confirmed: '0', pending: '0', checkins: '0', available: '0', revenue: 'R$ 0,00', refunded: '1' });
    }],

    [15, 'rajada: 30 compras simultâneas em E4 e em E5 → 5 × 202 e 25 × 409', async () => {
      for (const [label, name] of [['E4', names.e4], ['E5', names.e5]]) {
        const id = await createOk(S.a, { name, capacity: 5, price: '10,00' });
        await publish(S.a, id);
        if (label === 'E4') S.e4 = id;
        const tb = Date.now();
        const results = await Promise.all(
          Array.from({ length: 30 }, (_, i) => apiBuy(id, `carga${i + 1}-${runId}@example.com`, CARD.c0001)),
        );
        const counts = {};
        for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
        const summary = Object.entries(counts).map(([s, n]) => `${n} × ${s}`).join(', ');
        check(counts[202] === 5 && counts[409] === 25 && results.length === 30, `${label}: 5 × 202 e 25 × 409`, summary);
        const bad = results.filter((r) => r.status === 409 && JSON.stringify(r.json) !== '{"error":"sold_out"}');
        check(bad.length === 0, `${label}: todo 409 com {"error":"sold_out"}`, bad.map((r) => short(r.text, 60)).join(' ; '));
        await poll(
          async () => {
            const p = await panel(S.a, id);
            return { ok: p.confirmed === '5' && p.available === '0', got: panelString(p) };
          },
          tb + within(10000),
          `${label}: painel confirmed=5 e available=0`,
        );
      }
    }],

    [16, 'API: 401 sem chave/chave errada, 422 invalid_request e 404 ticket_not_found', async () => {
      const routes = [
        ['GET', '/api/partner/events', undefined],
        ['POST', `/api/partner/events/${S.e4}/purchases`, { buyerEmail: `auth-${runId}@example.com`, cardNumber: CARD.c0001 }],
        ['GET', `/api/partner/tickets/${S.T3}`, undefined],
      ];
      for (const [method, path, body] of routes) {
        for (const apiKey of [null, 'chave-errada']) {
          const r = await api(method, path, { body, apiKey });
          expectJson(r, 401, { error: 'unauthorized' }, `${method} ${path} ${apiKey === null ? 'sem chave' : 'com chave errada'}`);
        }
      }
      const inv = await api('POST', `/api/partner/events/${S.e4}/purchases`, { body: { buyerEmail: `inv-${runId}@example.com`, cardNumber: '123' } });
      expectJson(inv, 422, { error: 'invalid_request' }, 'compra com cardNumber "123"');
      const nf = await api('GET', '/api/partner/tickets/tkt_naoexiste0');
      expectJson(nf, 404, { error: 'ticket_not_found' }, 'GET /api/partner/tickets/tkt_naoexiste0');
    }],
  ];

  // Pré-checagem.
  try {
    const res = await fetch(`${web}/healthz`);
    check(res.status === 200, `GET ${web}/healthz → 200`, res.status);
    log('PASS pré-checagem');
  } catch (err) {
    const msg = err instanceof StepError ? err.message : `GET ${web}/healthz: ${err instanceof Error ? err.message : err}`;
    log(`FAIL pré-checagem — ${msg}`);
    return { ok: false, step: 1, error: msg, steps };
  }

  for (const [step, title, fn] of STEPS) {
    const start = Date.now();
    try {
      await fn();
    } catch (err) {
      const msg =
        err instanceof StepError
          ? err.message
          : `erro inesperado: ${err instanceof Error ? `${err.message}${err.cause ? ` (${err.cause.message ?? err.cause})` : ''}` : err}`;
      log(`FAIL passo ${step} — ${msg}`);
      return { ok: false, step, error: msg, steps };
    }
    const ms = Date.now() - start;
    steps.push({ step, ms, title });
    log(`PASS passo ${step} — ${title} [${(ms / 1000).toFixed(1)} s]`);
  }
  log(`FLOW OK — passos 2–16 (escala ${scale}) em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { ok: true, steps };
}

async function main() {
  const web = process.env.WEB || `http://localhost:${process.env.CATRACA_PORT || 3000}`;
  const api = process.env.API || web;
  const key = process.env.KEY || process.env.PARTNER_API_KEY || 'catraca-parceiro-2026';
  const scale = Number(process.env.FLOW_SCALE || 1);
  if (!Number.isFinite(scale) || scale <= 0) {
    console.log(`FAIL pré-checagem — FLOW_SCALE inválido: ${process.env.FLOW_SCALE}`);
    process.exit(1);
  }
  console.log(`Fluxo do avaliador — WEB=${web} API=${api} escala ${scale}`);
  const r = await runFlow({ web, api, key, scale });
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.log(`FAIL — erro inesperado: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
