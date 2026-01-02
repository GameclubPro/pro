const { TextDecoder } = require('util');
const buf = Buffer.from('D18ED186D188D184D180D18DD188D185','hex');
for (const enc of ['utf8','windows-1251','koi8-r','cp866']) {
  try {
    const dec = new TextDecoder(enc);
    console.log(enc + ':', dec.decode(buf));
  } catch (e) {
    console.log(enc + ':', e.message);
  }
}
