// Partial types for the Philips Hue CLIP v2 API — only the fields this app uses.
// Reference: https://developers.meethue.com/develop/hue-api-v2/api-reference/

export type HueRef = { rid: string; rtype: string };

export type HueXy = { x: number; y: number };

export type HueGamut = { red: HueXy; green: HueXy; blue: HueXy };

export type HueLight = {
  id: string;
  type: 'light';
  owner: HueRef;
  metadata: { name: string; archetype?: string };
  on: { on: boolean };
  dimming?: { brightness: number; min_dim_level?: number };
  color_temperature?: {
    mirek: number | null;
    mirek_valid: boolean;
    mirek_schema: { mirek_minimum: number; mirek_maximum: number };
  };
  color?: { xy: HueXy; gamut?: HueGamut; gamut_type?: 'A' | 'B' | 'C' | 'other' };
  mode?: 'normal' | 'streaming';
};

export type HueGroup = {
  id: string;
  type: 'room' | 'zone';
  metadata: { name: string; archetype?: string };
  children: HueRef[];
  services: HueRef[];
};

export type HueZigbeeConnectivity = {
  id: string;
  type: 'zigbee_connectivity';
  owner: HueRef;
  status: 'connected' | 'disconnected' | 'connectivity_issue' | 'unidirectional_incoming';
};

export type HueSceneAction = {
  target: HueRef;
  action: {
    on?: { on: boolean };
    dimming?: { brightness: number };
    color?: { xy: HueXy };
    color_temperature?: { mirek: number | null };
  };
};

export type HueScene = {
  id: string;
  type: 'scene';
  metadata: { name: string };
  group: HueRef;
  actions: HueSceneAction[];
  palette?: {
    color: { color: { xy: HueXy }; dimming?: { brightness: number } }[];
    dimming?: { brightness: number }[];
    color_temperature: { color_temperature: { mirek: number }; dimming?: { brightness: number } }[];
  };
  /** 0..1, how fast a dynamic palette moves. */
  speed?: number;
  auto_dynamic?: boolean;
  status?: { active: 'inactive' | 'static' | 'dynamic_palette' };
};

export type HueLightPut = {
  on?: { on: boolean };
  dimming?: { brightness: number };
  color?: { xy: HueXy };
  color_temperature?: { mirek: number };
  dynamics?: { duration: number };
};

export type HueResponseBody<T> = {
  data: T[];
  errors: { description: string }[];
};

/** Response of the unauthenticated `GET /api/0/config`. */
export type HueBridgeConfig = {
  name: string;
  bridgeid: string;
  modelid: string;
  apiversion: string;
  swversion: string;
  mac?: string;
};

/** One element of the array sent on each SSE `data:` line of `/eventstream/clip/v2`. */
export type HueEventContainer = {
  id: string;
  creationtime: string;
  type: 'update' | 'add' | 'delete' | 'error';
  data: ({ id: string; type: string } & Record<string, unknown>)[];
};
