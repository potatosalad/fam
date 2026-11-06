import {Impit} from 'impit';
const reject = async () => {throw new Error('Network disabled in synthetic CLI tests.');};
globalThis.fetch = reject;
Impit.prototype.fetch = reject;
