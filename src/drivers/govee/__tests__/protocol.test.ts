import {
  commandsFor,
  parseMessage,
  scanMessage,
  statusToLightState,
  temperatureMessage,
} from '../protocol';

const msg = (text: string) => JSON.parse(text).msg;

describe('Govee LAN protocol', () => {
  it('encodes scan and colour-temperature messages', () => {
    expect(msg(scanMessage())).toEqual({ cmd: 'scan', data: { account_topic: 'reserve' } });
    expect(msg(temperatureMessage(12000)).data.colorTemInKelvin).toBe(9000);
    expect(msg(temperatureMessage(1500)).data.colorTemInKelvin).toBe(2000);
  });

  it('parses scan and devStatus replies, ignoring junk', () => {
    expect(
      parseMessage(
        '{"msg":{"cmd":"scan","data":{"ip":"192.168.1.23","device":"1F:80:C5:32:32:36:72:4E","sku":"H6008"}}}',
      ),
    ).toEqual({ cmd: 'scan', data: { ip: '192.168.1.23', device: '1F:80:C5:32:32:36:72:4E', sku: 'H6008' } });
    const status = parseMessage(
      '{"msg":{"cmd":"devStatus","data":{"onOff":1,"brightness":40,"color":{"r":255,"g":0,"b":0},"colorTemInKelvin":0}}}',
    );
    expect(status?.cmd).toBe('devStatus');
    expect(parseMessage('not json')).toBeNull();
    expect(parseMessage('{"msg":{"cmd":"other","data":{}}}')).toBeNull();
  });

  it('maps status to light state (rgb vs white)', () => {
    expect(
      statusToLightState({ onOff: 1, brightness: 40, color: { r: 1, g: 2, b: 3 }, colorTemInKelvin: 0 }),
    ).toEqual({ on: true, brightness: 40, color: { mode: 'rgb', rgb: { r: 1, g: 2, b: 3 } } });
    expect(
      statusToLightState({ onOff: 0, brightness: 10, color: { r: 0, g: 0, b: 0 }, colorTemInKelvin: 2700 }).color,
    ).toEqual({ mode: 'temperature', kelvin: 2700 });
  });

  it('builds command sequences', () => {
    const cmds = (state: Parameters<typeof commandsFor>[0], on?: boolean) =>
      commandsFor(state, on).map((c) => msg(c).cmd);
    expect(cmds({ on: false })).toEqual(['turn']);
    expect(cmds({ brightness: 0 })).toEqual(['turn']);
    expect(cmds({ brightness: 50 }, true)).toEqual(['brightness']);
    expect(cmds({ brightness: 50 }, false)).toEqual(['turn', 'brightness']);
    expect(cmds({ on: true, color: { mode: 'rgb', rgb: { r: 255, g: 0, b: 0 } }, brightness: 80 }, true)).toEqual([
      'turn',
      'colorwc',
      'brightness',
    ]);
  });
});
