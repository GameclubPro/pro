const { TextDecoder, TextEncoder } = require("util");

const sample = "Привет";
const encoder = new TextEncoder(); // utf-8 encoder
const utf8Bytes = encoder.encode(sample);

console.log("utf8 bytes", utf8Bytes);
console.log("decoded as utf8", new TextDecoder("utf-8").decode(utf8Bytes));
console.log(
  "decoded as windows-1251 (expected gibberish)",
  new TextDecoder("windows-1251").decode(utf8Bytes),
);
