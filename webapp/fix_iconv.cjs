const iconv = require('iconv-lite');
const str = 'юцшфрэшх';
const fixed = iconv.decode(iconv.encode(str, 'win1251'), 'utf8');
console.log(fixed);
