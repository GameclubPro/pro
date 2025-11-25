const { TextDecoder, TextEncoder } = require("util");

const encoder = new TextEncoder();
const sample = "Игры";
const utf8Bytes = encoder.encode(sample);

console.log("utf8 decoded", new TextDecoder("utf-8").decode(utf8Bytes));
console.log("latin1 decoded (corrupted)", new TextDecoder("latin1").decode(utf8Bytes));
