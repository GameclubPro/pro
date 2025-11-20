const corrupt = 'юцшфрэшх';
const fixed = decodeURIComponent(escape(corrupt));
console.log('fixed:', fixed);
