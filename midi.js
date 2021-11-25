import midi from 'midi';
import path from 'path';
import YAML from 'yamljs';
import mqtt from 'mqtt';
import pattern from 'mqtt-pattern';

export const input = new midi.input();
const config = YAML.load('midi.yml');

input.ignoreTypes(false, false, false); 

const topicTemplate = 'midi/+device/+bank/+control';
const discoveryTemplate = '+discovery_prefix/+component/+node_id/+object_id/config';

const client = mqtt.connect('mqtt://hal9000.grid.robotjamie.com');

const clean = (value) => value.replace(/[^a-zA-Z0-9_-]/g, '_');

const device = config.controller;
const discovery_prefix = 'homeassistant';
const component = 'sensor';
const node_id = clean(device);

const lastValues = new WeakMap;

const discover = (note, bank) => {
  const name = `${bank.name} ${note.name}`;
  const model = config.model;
  const manufacturer = config.manufacturer;
  const unique_id = clean(`${manufacturer} ${model} ${name}`);
  const topic = pattern.fill(discoveryTemplate, {
    discovery_prefix,
    component,
    node_id,
    object_id: clean(name),
  });
  client.publish(topic, JSON.stringify({
    state_topic: pattern.fill(topicTemplate, { device, control: note.name, bank: bank.name }),
    name,
    unique_id,
    device: {
      identifiers: [unique_id],
      name,
      model,
      manufacturer,
    },
  }), {
    // retain: true
  });
};

const keyTypes = {
  [Symbol('slider')]: {
    notes: [ 3, 4, 5, 6, 7, 8, 50, 51, 52, 9 ],
    mapper: value => Math.floor(value / 127 * 256),
  },
  [Symbol('knob')]: {
    notes: [14, 15, 16, 17, 18, 19, 20, 21, 22],
    mapper: value => Math.floor(value / 127 * 256),
  },
  [Symbol('button')]: {
    notes: [23, 24, 25, 26, 27, 28, 29, 30, 31, 44, 45, 46, 48, 47, 49, 64, 67, 2, 1],
    mapper: value => value >= 127 ? 1 : 0,
  },
  [Symbol('rotary')]: {
    notes: [10],
    mapper(value, note) {
      const lastValue = lastValues.get(note);
      if (value > lastValue || (value === 127 && lastValue === 127)) return 'up';
      if (value < lastValue || (value === 0 && lastValue === 0)) return 'down';
      return null;
    } 
  },
}

const createKeyTypeMap = () => Object.getOwnPropertySymbols(keyTypes).reduce((map, key) => Object.assign(map, 
  keyTypes[key].notes.reduce((keys, id, number) => Object.assign(keys, { [id]: {
    type: key,
    mapper: keyTypes[key].mapper,
    name: config.keys.find(({ value }) => value === id)?.name || `${key.description} ${number + 1}`,
  } }), {})
  ), {});

const port = [...Array(input.getPortCount()).keys()]
  .map(port =>input.getPortName(port))
  .findIndex(name => name.includes(config.controller));

if(port >= 0) {
  input.openPort(port);
  console.log(`Opened port ${port}`);
}


const status = Object.keys(config.status).reduce((status, type) =>
  Object.assign(status, { [config.status[type].status]: { ...config.status[type], type } }), {});

const banks = Object.keys(config.banks).reduce((banks, index) =>
  Object.assign(banks, {
    [config.banks[index].value]: {
      ...config.banks[index],
      notes: createKeyTypeMap(),
      /*config.banks[index].notes && Object.keys(config.banks[index].notes).reduce((notes, indexN) => 
        Object.assign(notes, {
          [config.keys.find(key => key.name === config.banks[index].notes[indexN].key).value]: {
            ...config.keys.find(key => key.name === config.banks[index].notes[indexN].key),
            ...config.banks[index].notes[indexN],
          }
        }), {}), */
    }
  }), {});


  client.on('connect', () => {
    console.log('connected');
    Object.values(banks).forEach(bank =>
      Object.values(bank.notes).forEach(note => discover(note, bank)))
  });
  

let bank = banks[0]; // No way to retrieve bank on start, but assume known state

const keys = Object.keys(config.keys).reduce((keys, index) =>
  Object.assign(keys, { [config.keys[index].value]: config.keys[index] }), {});

input.on('message', (deltaTime, [statusNumber, ...data]) => {
  const { dataValue, id, type } = status[statusNumber];
  const value = data[dataValue];
  const key = data[id];
  switch(type) {
    case 'bank':
      bank = banks[value];
    break;
    case 'note':
      if (!bank) break;
      const note = bank.notes[key];
      if (!note) break;
      const lastValue = lastValues.get(note);
      const publishValue = note.mapper ? note.mapper(value, note) : value;
      // TODO use zero-crossing logic between banks and at startup. Sliders/knobs should not send 
      // messages until they have returned to their previously published state to avoid jumps.
      // Like a virtual motorized slider
      lastValues.set(note, value);
      const control = note.name;
      const topic = pattern.fill(topicTemplate, { device, control, bank: bank.name })
      if (publishValue || publishValue === 0) client.publish(topic, publishValue.toString());
    break;
  }
});
