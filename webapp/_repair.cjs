const {TextDecoder}=require('util');
const corrupted='‏צרפנ‎רץ';
const bytes=Buffer.from(corrupted, 'utf8');
const dec=new TextDecoder('windows-1251');
console.log(dec.decode(bytes));
