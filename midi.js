import midi from 'midi';
import path from 'path';
import YAML from 'yamljs';


export const input = new midi.input();
const config = YAML.load('midi.yml');

input.ignoreTypes(false, false, false); 

const lastValue = new WeakMap;

const keyTypes = {
  [Symbol('slider')]: {
    notes: [ 3, 4, 5, 6, 7, 8, 50, 51, 52, 9 ],
    mapper: value => Math.floor(value / 127 * 256),
  },
  [Symbol('knob')]: {
    notes: [14, 15, 16, 17, 18, 19, 20, 21, 22, 52],
    mapper: value => Math.floor(value / 127 * 256),
  },
  [Symbol('button')]: {
    notes: [23, 24, 25, 26, 28, 29, 31, 30, 44, 45, 46, 48, 47, 49, 64, 67, 2, 1],
    mapper: value => value >= 127 ? 1 : 0,
  },
  [Symbol('rotary')]: {
    notes: [10],
  },
}

const keyTypeMap = Object.getOwnPropertySymbols(keyTypes).reduce((map, key) => Object.assign(map, 
  keyTypes[key].notes.reduce((keys, id) => Object.assign(keys, { [id]: {
    type: key,
    mapper: keyTypes[key].mapper,
  } }), {})
  ), {});

console.log(keyTypeMap);


const port = [...Array(input.getPortCount()).keys()]
  .map(port =>input.getPortName(port))
  .findIndex(name => name.includes(config.controller));

if(port >= 0) {
  input.openPort(port);
}

const status = Object.keys(config.status).reduce((status, type) =>
  Object.assign(status, { [config.status[type].status]: { ...config.status[type], type } }), {});

console.log(status);

const banks = Object.keys(config.banks).reduce((banks, index) =>
  Object.assign(banks, {
    [config.banks[index].value]: {
      ...config.banks[index],
      notes: Object.keys(config.banks[index].notes).reduce((notes, indexN) => 
        Object.assign(notes, {
          [config.keys.find(key => key.name === config.banks[index].notes[indexN].key).value]: {
            ...config.keys.find(key => key.name === config.banks[index].notes[indexN].key),
            ...config.banks[index].notes[indexN],
          }
        }), {}),
    }
  }), {});

let bank = banks[0]; // No way to retrieve bank on start, but assume known state

const keys = Object.keys(config.keys).reduce((keys, index) =>
  Object.assign(keys, { [config.keys[index].value]: config.keys[index] }), {});

const mapType = (note, value) => {
  
}

input.on('message', (deltaTime, [statusNumber, ...data]) => {
  // return console.log('hit note', statusNumber, data, rest);

  const { dataValue, id, type } = status[statusNumber];
  const value = data[dataValue];
  const key = data[id];
  // console.log(key, value, data, id, type);

  switch(type) {
    case 'bank':
      bank = banks[value];
      console.log('bank', bank)
    break;
    case 'note':
      console.log(data);
      if (!bank) return;
      const note = bank.notes[key];
      
      if(note && note.topic) {
        const mappedValue = mapType(note, value);
        console.log('pub', note.topic, mappedValue);
        // mqtt.publish({
        //   topic: 'lights/set/Desk lamp/transitionTime',
        //   payload: String(0),
        //   qos: 0, // 0, 1, or 2
        //   retain: false // or true
        // });
        // mqtt.publish({
        //   topic: note.topic,
        //   payload: String(value),
        //   qos: 0, // 0, 1, or 2
        //   retain: false // or true
        // });

      }
    break;
  }
});
