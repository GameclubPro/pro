const iconv = require("iconv-lite");

const original = "Игры";
const utf8Bytes = Buffer.from(original, "utf8");

console.log("misread as latin1", iconv.decode(utf8Bytes, "latin1"));
console.log("misread as cp866", iconv.decode(utf8Bytes, "cp866"));
