const { TextDecoder } = require("util");

// "Игроки" encoded as CP866
const cp866Bytes = Uint8Array.from([0x88, 0xa3, 0xe0, 0xae, 0xaa, 0xa8]);

console.log("ibm866 ->", new TextDecoder("ibm866").decode(cp866Bytes));
console.log("utf8 ->", new TextDecoder("utf-8", { fatal: false }).decode(cp866Bytes));
console.log("windows-1251 ->", new TextDecoder("windows-1251").decode(cp866Bytes));
