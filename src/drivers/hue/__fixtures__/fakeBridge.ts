import type { HttpClient, HttpRequest, HttpResponse, StreamHandlers } from '../http';
import type { HueGroup, HueLight, HueScene, HueZigbeeConnectivity } from '../hueTypes';

export const BRIDGE_ID = '001788FFFE123456';
export const FINGERPRINT = 'ab'.repeat(32);

export const colorLight: HueLight = {
  id: 'light-color',
  type: 'light',
  owner: { rid: 'device-1', rtype: 'device' },
  metadata: { name: 'Lounge lamp', archetype: 'sultan_bulb' },
  on: { on: true },
  dimming: { brightness: 80, min_dim_level: 0.2 },
  color_temperature: {
    mirek: null,
    mirek_valid: false,
    mirek_schema: { mirek_minimum: 153, mirek_maximum: 500 },
  },
  color: {
    xy: { x: 0.6915, y: 0.3083 },
    gamut: { red: { x: 0.6915, y: 0.3083 }, green: { x: 0.17, y: 0.7 }, blue: { x: 0.1532, y: 0.0475 } },
    gamut_type: 'C',
  },
};

export const whiteLight: HueLight = {
  id: 'light-white',
  type: 'light',
  owner: { rid: 'device-2', rtype: 'device' },
  metadata: { name: 'Hall ceiling' },
  on: { on: false },
  dimming: { brightness: 40 },
  color_temperature: {
    mirek: 370,
    mirek_valid: true,
    mirek_schema: { mirek_minimum: 153, mirek_maximum: 454 },
  },
};

export const rooms: HueGroup[] = [
  {
    id: 'room-lounge',
    type: 'room',
    metadata: { name: 'Lounge' },
    children: [{ rid: 'device-1', rtype: 'device' }],
    services: [{ rid: 'gl-1', rtype: 'grouped_light' }],
  },
];

export const connectivity: HueZigbeeConnectivity[] = [
  { id: 'zb-1', type: 'zigbee_connectivity', owner: { rid: 'device-1', rtype: 'device' }, status: 'connected' },
  {
    id: 'zb-2',
    type: 'zigbee_connectivity',
    owner: { rid: 'device-2', rtype: 'device' },
    status: 'connectivity_issue',
  },
];

export const spookyScene: HueScene = {
  id: 'scene-spooky',
  type: 'scene',
  metadata: { name: 'Spooky' },
  group: { rid: 'room-lounge', rtype: 'room' },
  actions: [{ target: { rid: 'light-color', rtype: 'light' }, action: { on: { on: true }, color: { xy: { x: 0.25, y: 0.1 } } } }],
  palette: {
    color: [{ color: { xy: { x: 0.25, y: 0.1 } } }, { color: { xy: { x: 0.55, y: 0.4 } } }],
    color_temperature: [],
  },
};

export const readingScene: HueScene = {
  id: 'scene-read',
  type: 'scene',
  metadata: { name: 'Read' },
  group: { rid: 'room-lounge', rtype: 'room' },
  actions: [{ target: { rid: 'light-color', rtype: 'light' }, action: { color_temperature: { mirek: 233 } } }],
};

/** In-memory stand-in for a paired Hue bridge, implementing the same HttpClient the app uses. */
export class FakeBridge implements HttpClient {
  requests: HttpRequest[] = [];
  streams: { req: HttpRequest; handlers: StreamHandlers; closed: boolean }[] = [];
  linkButtonPressed = false;

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    const { pathname } = new URL(req.url);
    const ok = (data: unknown): HttpResponse => ({
      status: 200,
      body: JSON.stringify(data),
      fingerprint: FINGERPRINT,
      commonName: BRIDGE_ID.toLowerCase(),
    });

    if (pathname === '/api/0/config') {
      return ok({ name: 'Hue Bridge', bridgeid: BRIDGE_ID, modelid: 'BSB002', apiversion: '1.70.0', swversion: '1970' });
    }
    if (pathname === '/api' && req.method === 'POST') {
      return ok(
        this.linkButtonPressed
          ? [{ success: { username: 'app-key', clientkey: 'client-key' } }]
          : [{ error: { type: 101, address: '', description: 'link button not pressed' } }],
      );
    }
    if (req.headers?.['hue-application-key'] !== 'app-key') {
      return { status: 403, body: '{"errors":[{"description":"unauthorized user"}],"data":[]}' };
    }
    if (req.pinnedFingerprint !== FINGERPRINT) throw new Error('CERT_MISMATCH');

    const resource = pathname.replace('/clip/v2/resource/', '');
    const tables: Record<string, unknown[]> = {
      light: [colorLight, whiteLight],
      room: rooms,
      zone: [],
      zigbee_connectivity: connectivity,
      scene: [spookyScene, readingScene],
    };
    if (req.method === 'PUT') return ok({ data: [{ rid: resource.split('/')[1] }], errors: [] });
    if (tables[resource]) return ok({ data: tables[resource], errors: [] });
    return { status: 404, body: '{"errors":[{"description":"not found"}],"data":[]}' };
  }

  stream(req: HttpRequest, handlers: StreamHandlers) {
    const entry = { req, handlers, closed: false };
    this.streams.push(entry);
    return () => {
      entry.closed = true;
    };
  }

  /** Sends one SSE message on the latest open stream. */
  emit(containers: unknown[]) {
    const open = this.streams.filter((s) => !s.closed).at(-1);
    open?.handlers.onChunk(`id: 1:0\ndata: ${JSON.stringify(containers)}\n\n`);
  }
}
