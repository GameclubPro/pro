const {TextDecoder}=require('util');
const corrupted='‏צרפנ‎רץ';
const bytes=Uint8Array.from([...corrupted].map(ch=>ch.charCodeAt(0)));
const dec=new TextDecoder('utf-8');
console.log('bytes', bytes);
console.log('decoded as utf8 from codepoints:', dec.decode(bytes));
