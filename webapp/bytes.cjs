const s='юцшфрэшх';
const bLatin = Buffer.from(s, 'latin1');
console.log('latin1 bytes', bLatin);
const bUtf8 = Buffer.from(s, 'utf8');
console.log('utf8 bytes', bUtf8);
const dec = new TextDecoder('windows-1251');
console.log('latin bytes -> win1251:', dec.decode(bLatin));
console.log('utf8 bytes -> win1251:', dec.decode(bUtf8));
