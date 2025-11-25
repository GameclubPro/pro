const { TextDecoder } = require("util");

// CP1251 bytes for "Игроки"
const cp1251Bytes = Uint8Array.from([0xc8, 0xe3, 0xf0, 0xee, 0xea, 0xe8]);

const cp1251Decoder = new TextDecoder("windows-1251");
const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

console.log("cp1251 -> text", cp1251Decoder.decode(cp1251Bytes));
console.log("cp1251 misread as utf8", utf8Decoder.decode(cp1251Bytes));
