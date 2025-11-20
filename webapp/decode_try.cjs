const iconv=require('iconv-lite');
const s='¦þô úþüýðªv ºöõ ÷ðý ª';
const encs=['utf8','win1251','koi8-r','cp866','latin1','macintosh'];
for(const from of encs){
  for(const to of encs){
    try{
      const result = iconv.decode(iconv.encode(s, from), to);
      if(/[À-ßà-ÿ¸¨]/.test(result)){
        console.log(`${from}->${to}: ${result}`);
      }
    }catch(e){/* ignore*/}
  }
}
