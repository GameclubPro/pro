const str='юцшфрэшх';
const fixed = Buffer.from(str, 'latin1').toString('utf8');
console.log(fixed);
