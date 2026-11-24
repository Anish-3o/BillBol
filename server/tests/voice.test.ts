import request from 'supertest';
import { keytermsFor } from '../src/ai/sarvam';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { registerShop } from './helpers/auth';
import { clearTestDB, closeTestDB, connectTestDB } from './helpers/db';

// The real Sarvam API is never called: fetch is mocked, and each test checks what would have
// been sent and how the answer reaches the app.
const app = createApp();
let shop: Awaited<ReturnType<typeof registerShop>>;
const mutableEnv = env as { SARVAM_API_KEY?: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const authed = (req: request.Test) => req.set('Cookie', [`accessToken=${shop.accessToken}`]);
const transcribe = (audio: Buffer, lang = 'hi', type = 'audio/webm;codecs=opus') =>
  authed(request(app).post(`/api/voice/transcribe?lang=${lang}`)).set('Content-Type', type).send(audio);
const speak = (body: object) => authed(request(app).post('/api/voice/speak')).send(body);

beforeAll(connectTestDB);
beforeEach(async () => {
  mutableEnv.SARVAM_API_KEY = 'test-sarvam-key';
  shop = await registerShop(app);
  await authed(request(app).post('/api/products')).send({ name: 'Aashirvaad Atta 5kg', unit: 'packet', pricePaise: 28500, gstRate: 5 });
});
afterEach(async () => {
  mutableEnv.SARVAM_API_KEY = undefined;
  jest.restoreAllMocks();
  await clearTestDB();
});
afterAll(closeTestDB);

describe('POST /api/voice/transcribe', () => {
  it("sends the recording in the shop's language, with product names as key terms", async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(json({ request_id: 'r1', transcript: ' दोन किलो साखर ', language_code: 'mr-IN' }));

    const res = await transcribe(Buffer.from('fake-webm-audio'), 'mr');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ transcript: 'दोन किलो साखर' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.sarvam.ai/speech-to-text');
    expect((init!.headers as Record<string, string>)['api-subscription-key']).toBe('test-sarvam-key');
    const form = init!.body as FormData;
    expect(form.get('model')).toBe('saaras:v4');
    expect(form.get('language_code')).toBe('mr-IN');
    expect(JSON.parse(form.get('keyterms') as string)).toEqual(['Aashirvaad Atta']);
    expect((form.get('file') as File).type).toBe('audio/webm');
  });

  it('rejects requests without audio and recordings that are too long', async () => {
    expect((await authed(request(app).post('/api/voice/transcribe')).send({ text: 'hi' })).status).toBe(400);
    expect((await transcribe(Buffer.alloc(3 * 1024 * 1024))).status).toBe(413);
  });

  it('says clearly when Sarvam rejects the key', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(json({ error: { message: 'Invalid API key', code: 'invalid_api_key_error' } }, 403));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await transcribe(Buffer.from('audio'));

    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/SARVAM_API_KEY/);
  });
});

describe('POST /api/voice/speak', () => {
  it('returns MP3 audio spoken by the configured voice', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(json({ request_id: 'r2', audios: [Buffer.from('mp3-bytes').toString('base64')] }));

    const res = await speak({ text: 'कुल ₹130। और कुछ?', lang: 'hi' }).buffer(true).responseType('blob');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/audio\/mpeg/);
    expect(Buffer.from(res.body).toString()).toBe('mp3-bytes');
    const sent = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(sent).toMatchObject({ text: 'कुल ₹130। और कुछ?', language_code: 'hi-IN', model: 'bulbul:v3', speaker: 'shubh', output_audio_codec: 'mp3' });
  });

  it('answers 503 when Sarvam is not set up, so the app uses the browser voice', async () => {
    mutableEnv.SARVAM_API_KEY = undefined;
    const fetchMock = jest.spyOn(global, 'fetch');

    const res = await speak({ text: 'नमस्ते', lang: 'hi' });

    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates the text and requires login', async () => {
    expect((await speak({ text: '' })).status).toBe(400);
    expect((await speak({ text: 'x'.repeat(601) })).status).toBe(400);
    expect((await request(app).post('/api/voice/speak').send({ text: 'hi' })).status).toBe(401);
  });
});

describe('voice status and key terms', () => {
  it('tells the app to use Sarvam when a key is set', async () => {
    expect((await authed(request(app).get('/api/assistant/status'))).body.voice).toBe('sarvam');
  });

  it('turns product names into the words customers say', () => {
    expect(keytermsFor(['Aashirvaad Atta 5kg', 'Sugar (loose)', 'Amul Milk 500ml', 'Fortune Mustard Oil 1L', 'Sugar (loose)'])).toEqual([
      'Aashirvaad Atta',
      'Sugar',
      'Amul Milk',
      'Fortune Mustard Oil',
    ]);
  });
});
